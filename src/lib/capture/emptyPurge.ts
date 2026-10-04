// Server only. Deleting empty capture runs (rule in ./empty): the Delete action on one run (creator or owner,
// DELETE /api/session/<id>) and the purge EMPTY_PURGE_MS after the run ended (retention cron, every workspace).
// Storage objects first, then the session rows (children and frame rows cascade), like the agent delete.
// The purge also covers runs from before the rule (no events, no Work Map): that is the one-time cleanup.
import type { SupabaseClient } from "@supabase/supabase-js";
import { fileDataPort, STORAGE_BATCH, supabaseDataPort, type DataPort } from "@/lib/agents/admin";
import { fileStore } from "@/lib/store";
import type { QAPair } from "@/lib/types";
import { EMPTY_MIN_EVENTS, EMPTY_PURGE_MS, isAnswered, isEmptyCapture, isPurgeable, type RunFacts } from "./empty";

export const EMPTY_PURGE_BATCH = 200;

export type DeletePort = Pick<DataPort, "frameObjectsOf" | "removeObjects" | "deleteSessions">;
export type EmptyPurgePort = DeletePort & {
  /** Empty capture runs (isEmptyCapture) that ended at or before cutoffMs, at most limit, with their facts. */
  candidates(cutoffMs: number, limit: number): Promise<(RunFacts & { id: string })[]>;
};

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/** Frame objects from Storage (listed by session prefix, as the agent delete does), then the session rows. */
export async function deleteSessionsWithFrames(port: DeletePort, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const paths = await port.frameObjectsOf(ids);
  for (const batch of chunks(paths, STORAGE_BATCH)) await port.removeObjects(batch);
  await port.deleteSessions(ids);
}

/** Deletes the empty runs that ended at least 24 h before now. Idempotent; at most limit per run. */
export async function purgeEmptySessions(port: EmptyPurgePort, nowMs: number, limit = EMPTY_PURGE_BATCH): Promise<{ purged: number }> {
  const ids = (await port.candidates(nowMs - EMPTY_PURGE_MS, limit)).filter((f) => isPurgeable(f, nowMs)).map((f) => f.id);
  await deleteSessionsWithFrames(port, ids);
  return { purged: ids.length };
}

/** Local mode: the file store's summaries carry the empty mark. */
export function fileEmptyPurgePort(): EmptyPurgePort {
  const data = fileDataPort();
  return {
    frameObjectsOf: data.frameObjectsOf,
    removeObjects: data.removeObjects,
    deleteSessions: data.deleteSessions,
    async candidates(cutoffMs, limit) {
      return (await fileStore.listSessions())
        .filter((s) => s.empty && s.ended_at && Date.parse(s.ended_at) <= cutoffMs)
        .slice(0, limit)
        .map((s) => ({ id: s.id, kind: s.kind, started_at: s.started_at, ended_at: s.ended_at, events: s.counts.events, answered: 0, work: false }));
    },
  };
}

type PgRes = { data: unknown; error: { message?: string; code?: string } | null };
function must<T>(what: string, res: PgRes): T {
  if (res.error) throw new Error(`${what}: ${res.error.message ?? String(res.error)}`);
  return res.data as T;
}

type CandidateRow = {
  id: string;
  started_at: string;
  ended_at: string | null;
  first_step: unknown;
  process_id?: string | null;
  session_events?: { count: number }[] | null;
};

/** Rows read per page; must not exceed the project's max-rows. */
export const EMPTY_SCAN_PAGE = 500;

/**
 * Service role, every workspace. Only the cron route calls it. Plain filters only (kind = capture, ended_at at or
 * before the cutoff), pages in ended_at order; the shared rule (isEmptyCapture) picks the empty runs in code.
 * first_step reads workmap->steps->0 (null for no Work Map or no steps) so Work Map bodies are not transferred.
 */
export function supabaseEmptyPurgePort(db: SupabaseClient, opts: { pageSize?: number } = {}): EmptyPurgePort {
  const data = supabaseDataPort(db, "");
  const page = opts.pageSize ?? EMPTY_SCAN_PAGE;
  const select = (cols: string, cutoffMs: number, from: number) =>
    db
      .from("sessions")
      .select(cols)
      .eq("kind", "capture")
      .lte("ended_at", new Date(cutoffMs).toISOString())
      .order("ended_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + page - 1);
  return {
    frameObjectsOf: data.frameObjectsOf,
    removeObjects: data.removeObjects,
    async deleteSessions(ids) {
      if (ids.length === 0) return;
      must("delete empty sessions", await db.from("sessions").delete().eq("kind", "capture").in("id", ids));
    },
    async candidates(cutoffMs, limit) {
      const base = "id,started_at,ended_at,first_step:workmap->steps->0,session_events(count)";
      let cols = `${base},process_id`;
      const out: (RunFacts & { id: string })[] = [];
      for (let from = 0; out.length < limit; from += page) {
        let res = (await select(cols, cutoffMs, from)) as PgRes;
        // sessions.process_id is missing until migration 20261004030000_processes is applied.
        if (res.error?.code === "42703" && cols !== base) {
          cols = base;
          res = (await select(cols, cutoffMs, from)) as PgRes;
        }
        const rows = must<CandidateRow[]>("select empty sessions", res);
        const facts = rows
          .map((r) => ({
            id: r.id,
            kind: "capture" as const,
            started_at: r.started_at,
            ended_at: r.ended_at,
            events: r.session_events?.[0]?.count ?? 0,
            answered: 0,
            work: r.first_step !== null && r.first_step !== undefined,
            process_id: r.process_id ?? null,
          }))
          .filter(isEmptyCapture);
        // Answered questions matter only for runs with few events (the rest are empty by duration or not at all).
        const few = facts.filter((f) => !isEmptyCapture({ ...f, events: EMPTY_MIN_EVENTS })).map((f) => f.id);
        if (few.length > 0) {
          const qa = must<{ session_id: string; payload: QAPair }[]>(
            "select empty session_qa",
            (await db.from("session_qa").select("session_id,payload").in("session_id", few)) as PgRes,
          );
          for (const q of qa) {
            const f = facts.find((x) => x.id === q.session_id);
            if (f && isAnswered(q.payload)) f.answered += 1;
          }
        }
        out.push(...facts.filter(isEmptyCapture));
        if (rows.length < page) break;
      }
      return out.slice(0, limit);
    },
  };
}
