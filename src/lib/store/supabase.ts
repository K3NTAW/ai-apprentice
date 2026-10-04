// Supabase backend: tables sessions, session_events, session_transcript, session_qa, session_frames
// and the private Storage bucket 'frames' at <workspaceId>/<sessionId>/<name>. Server only.
//
// Errors: supabase-js resolves to { data, error } and does not throw, so every query and storage error
// is thrown here (https://supabase.com/docs/reference/javascript/select). Only exceptions: no session row
// maps to null on getSession and to SessionNotFoundError on writes; a storage not-found on readFrame maps to null.
// RLS denial and a missing session are indistinguishable to the client (both return no row), so both map
// to null / SessionNotFoundError.
//
// Row cap: PostgREST returns at most max-rows (1000 by default on Supabase) per select
// (https://supabase.com/docs/guides/api/rest/max-rows, https://supabase.com/docs/reference/javascript/range).
// Every multi-row select has an explicit order and is paged with .range() until a short page.
// pageSize must not exceed the project's max-rows, otherwise a capped page looks short and paging stops.
import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redactText } from "@/lib/redact";
import {
  AgentSchema,
  newId,
  SessionSchema,
  type Agent,
  type Avatar,
  type QAPair,
  type ScreenEvent,
  type Session,
  type SessionDigest,
  type TranscriptEntry,
} from "@/lib/types";
import {
  AgentNotFoundError,
  assertFrameName,
  assertId,
  assertRange,
  frameName,
  hasOpenRange,
  inRange,
  isOffRecord,
  isValidAgentId,
  RECENT_SESSIONS_DEFAULT,
  redactOpts,
  SessionNotFoundError,
  type OffRecordRange,
  type SessionStore,
  type SessionSummary,
} from "./types";

const BUCKET = "frames";
const DEFAULT_PAGE_SIZE = 1000;
// Small chunks keep .in() filters well inside URL length limits.
const IN_CHUNK = 100;

type SessionRow = {
  id: string;
  workspace_id: string;
  created_by: string | null;
  kind: Session["kind"];
  expert: string | null;
  started_at: string;
  ended_at: string | null;
  off_record_ranges: OffRecordRange[] | null;
  workmap: Session["workmap"] | null;
  agent_id?: string | null;
};
type AgentRow = {
  id: string;
  workspace_id: string;
  name: string;
  role: string;
  expert_name: string | null;
  avatar: Avatar;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};
type PayloadRow<T> = { id: number; t: number; payload: T };
type FrameRow = { name: string; t: number | null; storage_path: string };

type Result<T> = { data: T | null; error: unknown; count?: number | null };

function fail(op: string, error: unknown): never {
  const e = (error ?? {}) as { message?: string; code?: string };
  const err = new Error(`supabase ${op} failed: ${e.message ?? String(error)}${e.code ? ` (${e.code})` : ""}`);
  (err as Error & { cause?: unknown }).cause = error;
  throw err;
}

function check<T>(op: string, res: Result<T>): T | null {
  if (res.error) fail(op, res.error);
  return res.data;
}

function toAgent(row: AgentRow): Agent {
  return AgentSchema.parse({
    id: row.id,
    workspace_id: row.workspace_id,
    name: row.name,
    role: row.role,
    ...(row.expert_name !== null ? { expert_name: row.expert_name } : {}),
    avatar: row.avatar,
    created_at: normTs(row.created_at),
    updated_at: normTs(row.updated_at),
  });
}

/**
 * Reads skip a row that fails AgentSchema (logged by agent id) instead of throwing,
 * so one bad row never turns GET /api/agents into a 500.
 */
function toAgentOrSkip(row: AgentRow): Agent | null {
  try {
    return toAgent(row);
  } catch {
    console.error(`supabase agents: skipped agent ${row.id}: row does not match AgentSchema`);
    return null;
  }
}

/** SQLSTATE 23503 on sessions_agent_fkey: the agent was deleted between the check and the insert. */
function isAgentFkViolation(error: unknown): boolean {
  const e = (error ?? {}) as { code?: unknown; message?: unknown; details?: unknown };
  return e.code === "23503" && [e.message, e.details].some((v) => typeof v === "string" && v.includes("sessions_agent_fkey"));
}

/** Postgres returns timestamptz as e.g. 2026-10-03T19:35:00.123+00:00; the app uses toISOString() form. */
function normTs(v: string): string {
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? v : d.toISOString();
}

/**
 * Storage not-found rule: status or statusCode in {400, 404} and a message matching /not found/i.
 * Storage answers a missing object with 400 or 404 depending on version (https://supabase.com/docs/guides/storage/debugging/error-codes).
 */
export function isStorageNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { status?: unknown; statusCode?: unknown; message?: unknown };
  const codes = [e.status, e.statusCode].map((c) => Number(c));
  return codes.some((c) => c === 400 || c === 404) && typeof e.message === "string" && /not found/i.test(e.message);
}

/** Append-race cleanup failed after the insert succeeded; data may remain until the next setOffRecord sweep. */
export class OffRecordCleanupError extends Error {
  constructor(id: string, cause: unknown) {
    super(
      `off_record_cleanup_failed: session ${id}: rows written during an off-record change may remain until the next setOffRecord sweep`,
    );
    this.name = "OffRecordCleanupError";
    (this as Error & { cause?: unknown }).cause = cause;
  }
}

export function createSupabaseStore(
  client: SupabaseClient,
  ctx: { workspaceId: string; userId: string },
  opts: { pageSize?: number } = {},
): SessionStore {
  const { workspaceId, userId } = ctx;
  const pageSize = opts.pageSize ?? DEFAULT_PAGE_SIZE;
  const objectPath = (id: string, name: string) => `${workspaceId}/${id}/${name}`;

  // Builds a fresh ordered query per page; .range() is applied here.
  type Ranged = { range(from: number, to: number): PromiseLike<Result<unknown[]>> };
  async function selectAll<T>(op: string, build: () => Ranged): Promise<T[]> {
    const out: T[] = [];
    for (let from = 0; ; from += pageSize) {
      const page = (check(op, await build().range(from, from + pageSize - 1)) ?? []) as T[];
      out.push(...page);
      if (page.length < pageSize) return out;
    }
  }

  async function readRow(id: string): Promise<SessionRow | null> {
    const res = await client.from("sessions").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
    return check("select sessions", res) as SessionRow | null;
  }

  async function requireRow(id: string): Promise<SessionRow> {
    assertId(id);
    const row = await readRow(id);
    if (!row) throw new SessionNotFoundError(id);
    return row;
  }

  // Assembly rules: null columns are omitted, frames is omitted when there are none (rows with null t are
  // skipped), timestamps are normalised, and the result is parsed with SessionSchema (throws on failure).
  async function assemble(row: SessionRow): Promise<Session> {
    const id = row.id;
    const [events, transcript, qa, frames] = await Promise.all([
      selectAll<PayloadRow<ScreenEvent>>("select session_events", () =>
        client
          .from("session_events")
          .select("id,t,payload")
          .eq("session_id", id)
          .order("t", { ascending: true })
          .order("id", { ascending: true }),
      ),
      selectAll<PayloadRow<TranscriptEntry>>("select session_transcript", () =>
        client
          .from("session_transcript")
          .select("id,t,payload")
          .eq("session_id", id)
          .order("t", { ascending: true })
          .order("id", { ascending: true }),
      ),
      selectAll<{ payload: QAPair }>("select session_qa", () =>
        client
          .from("session_qa")
          .select("qa_id,t,payload")
          .eq("session_id", id)
          .order("t", { ascending: true, nullsFirst: false })
          .order("qa_id", { ascending: true }),
      ),
      selectAll<FrameRow>("select session_frames", () =>
        client
          .from("session_frames")
          .select("name,t,storage_path")
          .eq("session_id", id)
          .order("t", { ascending: true })
          .order("name", { ascending: true }),
      ),
    ]);
    const frameList = frames.filter((f) => f.t !== null).map((f) => ({ name: f.name, t: f.t as number }));
    return SessionSchema.parse({
      id,
      kind: row.kind,
      started_at: normTs(row.started_at),
      ...(row.ended_at !== null ? { ended_at: normTs(row.ended_at) } : {}),
      ...(row.expert !== null ? { expert: row.expert } : {}),
      events: events.map((r) => r.payload),
      transcript: transcript.map((r) => r.payload),
      qa: qa.map((r) => r.payload),
      ...(row.workmap !== null ? { workmap: row.workmap } : {}),
      off_record_ranges: row.off_record_ranges ?? [],
      ...(frameList.length > 0 ? { frames: frameList } : {}),
      ...(row.agent_id ? { agent_id: row.agent_id } : {}),
    });
  }

  async function load(id: string): Promise<Session> {
    const row = await readRow(id);
    if (!row) throw new SessionNotFoundError(id);
    return assemble(row);
  }

  /** Update on sessions that treats an empty result (missing or hidden by RLS) as SessionNotFoundError. */
  async function updateRow(id: string, values: Partial<SessionRow>): Promise<void> {
    const res = await client.from("sessions").update(values).eq("id", id).eq("workspace_id", workspaceId).select("id");
    const rows = check("update sessions", res) as unknown[] | null;
    if (!rows || rows.length === 0) throw new SessionNotFoundError(id);
  }

  async function currentRanges(id: string): Promise<OffRecordRange[]> {
    const row = await readRow(id);
    if (!row) throw new SessionNotFoundError(id);
    return row.off_record_ranges ?? [];
  }

  async function deleteByIds(table: string, ids: number[]): Promise<void> {
    for (let i = 0; i < ids.length; i += IN_CHUNK) {
      check(`delete ${table}`, await client.from(table).delete().in("id", ids.slice(i, i + IN_CHUNK)));
    }
  }

  // Appends: read ranges, skip off-record items, insert, then re-read the ranges and delete just-inserted rows
  // that now fall in a range or if a range is now open (a setOffRecord may have run in between).
  async function appendRows<T extends { t: number }>(
    id: string,
    table: "session_events" | "session_transcript",
    items: T[],
    prepare: (row: SessionRow, item: T) => T,
  ): Promise<Session> {
    const row = await requireRow(id);
    const ranges = row.off_record_ranges ?? [];
    if (hasOpenRange(ranges)) return assemble(row);
    const keep = items.filter((e) => !isOffRecord(ranges, e.t)).map((e) => prepare(row, e));
    if (keep.length > 0) {
      const res = await client
        .from(table)
        .insert(keep.map((e) => ({ session_id: id, t: e.t, payload: e })))
        .select("id,t");
      const inserted = (check(`insert ${table}`, res) ?? []) as Array<{ id: number; t: number }>;
      try {
        const now = await currentRanges(id);
        const drop = hasOpenRange(now) ? inserted : inserted.filter((r) => isOffRecord(now, r.t));
        await deleteByIds(table, drop.map((r) => r.id));
      } catch (err) {
        throw new OffRecordCleanupError(id, err);
      }
    }
    return load(id);
  }

  async function removeObjects(paths: string[]): Promise<void> {
    for (let i = 0; i < paths.length; i += IN_CHUNK) {
      const res = await client.storage.from(BUCKET).remove(paths.slice(i, i + IN_CHUNK));
      if (res.error) fail("storage remove", res.error);
    }
  }

  async function purge(id: string, r: OffRecordRange & { to: number }): Promise<void> {
    // (2) rows, inclusive on both ends like the file backend's inRange.
    for (const table of ["session_events", "session_transcript"]) {
      check(`delete ${table}`, await client.from(table).delete().eq("session_id", id).gte("t", r.from).lte("t", r.to));
    }
    // (3) frame objects first, (4) frame rows last, so a retry still finds the rows whose objects remain.
    const frames = await selectAll<FrameRow>("select session_frames", () =>
      client
        .from("session_frames")
        .select("name,t,storage_path")
        .eq("session_id", id)
        .gte("t", r.from)
        .lte("t", r.to)
        .order("t", { ascending: true })
        .order("name", { ascending: true }),
    );
    if (frames.length === 0) return;
    await removeObjects(frames.map((f) => f.storage_path));
    const names = frames.map((f) => f.name);
    for (let i = 0; i < names.length; i += IN_CHUNK) {
      check(
        "delete session_frames",
        await client
          .from("session_frames")
          .delete()
          .eq("session_id", id)
          .in("name", names.slice(i, i + IN_CHUNK)),
      );
    }
  }

  const store: SessionStore = {
    async createSession(input) {
      // The composite foreign key also enforces this; checking first gives a typed error.
      if (input.agent_id !== undefined && !(await store.getAgent(input.agent_id))) throw new AgentNotFoundError(input.agent_id);
      // Unique violation on the id is thrown, no retry.
      const res = await client
        .from("sessions")
        .insert({
          id: newId("s"),
          workspace_id: workspaceId,
          created_by: userId,
          kind: input.kind,
          expert: input.expert ? input.expert : null,
          started_at: new Date().toISOString(),
          off_record_ranges: [],
          ...(input.agent_id ? { agent_id: input.agent_id } : {}),
        })
        .select("*")
        .single();
      // Delete race: the agent went away after the check above; the route answers 404 either way.
      if (input.agent_id !== undefined && isAgentFkViolation(res.error)) throw new AgentNotFoundError(input.agent_id);
      const row = check("insert sessions", res) as SessionRow;
      return assemble(row);
    },

    async getSession(id) {
      assertId(id);
      const row = await readRow(id);
      return row ? assemble(row) : null;
    },

    // One query per page: the child counts are PostgREST embedded counts, no query per session.
    async listSessions() {
      type Counted = { count: number }[] | null | undefined;
      type CountedRow = SessionRow & { session_events: Counted; session_transcript: Counted; session_qa: Counted };
      const n = (c: Counted) => c?.[0]?.count ?? 0;
      const rows = await selectAll<CountedRow>("select sessions", () =>
        client
          .from("sessions")
          .select("*,session_events(count),session_transcript(count),session_qa(count)")
          .eq("workspace_id", workspaceId)
          .order("started_at", { ascending: false })
          .order("id", { ascending: false }),
      );
      return rows.map(
        (r): SessionSummary => ({
          id: r.id,
          kind: r.kind,
          started_at: normTs(r.started_at),
          ...(r.ended_at !== null ? { ended_at: normTs(r.ended_at) } : {}),
          ...(r.expert !== null ? { expert: r.expert } : {}),
          counts: { events: n(r.session_events), transcript: n(r.session_transcript), qa: n(r.session_qa) },
          has_workmap: r.workmap !== null,
          ...(r.agent_id ? { agent_id: r.agent_id } : {}),
        }),
      );
    },

    async listSessionDigests() {
      const rows = await selectAll<Omit<SessionRow, "workspace_id">>("select session digests", () =>
        client
          .from("sessions")
          .select("id,kind,expert,agent_id,started_at,ended_at,workmap,off_record_ranges,created_by")
          .eq("workspace_id", workspaceId)
          .order("started_at", { ascending: false })
          .order("id", { ascending: false }),
      );
      return rows.map(
        (r): SessionDigest => ({
          id: r.id,
          kind: r.kind,
          started_at: normTs(r.started_at),
          ...(r.ended_at !== null ? { ended_at: normTs(r.ended_at) } : {}),
          ...(r.expert !== null ? { expert: r.expert } : {}),
          ...(r.workmap !== null ? { workmap: r.workmap } : {}),
          off_record_ranges: r.off_record_ranges ?? [],
          ...(r.agent_id ? { agent_id: r.agent_id } : {}),
          created_by: r.created_by,
        }),
      );
    },

    // One query, no child counts: the shell calls this on every page. has_workmap reads workmap->>task
    // (always set by saveWorkMap) so the workmap body is not transferred.
    async recentSessions(limit = RECENT_SESSIONS_DEFAULT) {
      const res = await client
        .from("sessions")
        .select("id,kind,expert,agent_id,started_at,ended_at,has_workmap:workmap->>task")
        .eq("workspace_id", workspaceId)
        .order("started_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(Math.max(0, limit));
      if (res.error) fail("select recent sessions", res.error);
      type RecentRow = Pick<SessionRow, "id" | "kind" | "expert" | "started_at" | "ended_at" | "agent_id"> & { has_workmap: string | null };
      return ((res.data ?? []) as RecentRow[]).map(
        (r): SessionSummary => ({
          id: r.id,
          kind: r.kind,
          started_at: normTs(r.started_at),
          ...(r.ended_at !== null ? { ended_at: normTs(r.ended_at) } : {}),
          ...(r.expert !== null ? { expert: r.expert } : {}),
          counts: { events: 0, transcript: 0, qa: 0 },
          has_workmap: r.has_workmap !== null,
          ...(r.agent_id ? { agent_id: r.agent_id } : {}),
        }),
      );
    },

    appendEvents(id, events) {
      return appendRows(id, "session_events", events, (_, e) => e);
    },

    appendTranscript(id, entries) {
      // One read of the session's expert per call for the redaction options, accepted.
      return appendRows(id, "session_transcript", entries, (row, e) => ({
        ...e,
        text: redactText(e.text, redactOpts(row.expert)).text,
        redacted: true,
      }));
    },

    async upsertQA(id, qa) {
      const row = await requireRow(id);
      const opts = redactOpts(row.expert);
      const clean: QAPair = {
        ...qa,
        question: redactText(qa.question, opts).text,
        ...(qa.answer !== undefined ? { answer: redactText(qa.answer, opts).text } : {}),
      };
      const res = await client
        .from("session_qa")
        .upsert({ session_id: id, qa_id: qa.id, t: qa.t_question ?? null, payload: clean }, { onConflict: "session_id,qa_id" });
      check("upsert session_qa", res);
      return load(id);
    },

    /**
     * No transaction is available, so the steps are ordered to converge on retry:
     * (1) write the new ranges, (2) delete events and transcript rows inside every range to purge,
     * (3) remove the frame objects inside it, (4) delete those frame rows last.
     * Closing purges the union of the merged range and any already-recorded closed range that overlaps it,
     * so a retry after a partial failure finishes the earlier purge. A closed range already covered by a
     * recorded closed range is not appended again (covers the identical case).
     * Accepted: two concurrent setOffRecord calls on one session can lose a range (read-modify-write on jsonb);
     * one expert drives one session, so this is not mitigated.
     */
    async setOffRecord(id, range) {
      const row = await requireRow(id);
      assertRange(range);
      const ranges = (row.off_record_ranges ?? []).map((r) => ({ ...r }));
      const openIdx = ranges.findIndex((r) => r.to === undefined);
      if (range.to === undefined) {
        if (openIdx < 0) {
          ranges.push({ from: range.from });
          await updateRow(id, { off_record_ranges: ranges });
        }
        return load(id);
      }
      let merged: { from: number; to: number };
      if (openIdx >= 0) {
        merged = { from: Math.min(ranges[openIdx].from, range.from), to: range.to };
        ranges[openIdx] = merged;
      } else {
        merged = { from: range.from, to: range.to };
        const covered = ranges.some((r) => r.to !== undefined && r.from <= merged.from && r.to >= merged.to);
        if (!covered) ranges.push(merged);
      }
      const toPurge: Array<{ from: number; to: number }> = [merged];
      for (const r of row.off_record_ranges ?? []) {
        if (r.to !== undefined && r.from <= merged.to && r.to >= merged.from) toPurge.push({ from: r.from, to: r.to });
      }
      await updateRow(id, { off_record_ranges: ranges });
      for (const r of toPurge) await purge(id, r);
      return load(id);
    },

    async saveWorkMap(id, workmap) {
      assertId(id);
      await updateRow(id, { workmap });
      return load(id);
    },

    async endSession(id) {
      const row = await requireRow(id);
      if (row.ended_at === null) await updateRow(id, { ended_at: new Date().toISOString() });
      return load(id);
    },

    async saveFrame(id, t, data) {
      const row = await requireRow(id);
      const name = frameName(t);
      const ranges = row.off_record_ranges ?? [];
      if (hasOpenRange(ranges) || isOffRecord(ranges, t)) return { stored: false, reason: "off_record" };
      const p = objectPath(id, name);
      const up = await client.storage.from(BUCKET).upload(p, data, { upsert: true, contentType: "image/jpeg" });
      if (up.error) fail("storage upload", up.error);
      check(
        "upsert session_frames",
        await client
          .from("session_frames")
          .upsert({ session_id: id, name, t, storage_path: p }, { onConflict: "session_id,name" }),
      );
      // Cleanup order: object first, then row, so a later sweep still finds the row if the removal fails.
      try {
        const now = await currentRanges(id);
        if (hasOpenRange(now) || now.some((r) => inRange(t, r))) {
          await removeObjects([p]);
          check(
            "delete session_frames",
            await client.from("session_frames").delete().eq("session_id", id).eq("name", name),
          );
          return { stored: false, reason: "off_record" };
        }
      } catch (err) {
        throw new OffRecordCleanupError(id, err);
      }
      return { stored: true, name };
    },

    async readFrame(id, name) {
      assertId(id);
      assertFrameName(name);
      const res = await client.storage.from(BUCKET).download(objectPath(id, name));
      if (res.error) {
        if (isStorageNotFound(res.error)) return null;
        fail("storage download", res.error);
      }
      return Buffer.from(await (res.data as Blob).arrayBuffer());
    },

    async listAgents() {
      const rows = await selectAll<AgentRow>("select agents", () =>
        client
          .from("agents")
          .select("*")
          .eq("workspace_id", workspaceId)
          .order("created_at", { ascending: false })
          .order("id", { ascending: false }),
      );
      return rows.map(toAgentOrSkip).filter((a): a is Agent => a !== null);
    },

    async getAgent(id) {
      if (!isValidAgentId(id)) return null;
      const res = await client.from("agents").select("*").eq("id", id).eq("workspace_id", workspaceId).maybeSingle();
      const row = check("select agents", res) as AgentRow | null;
      return row ? toAgentOrSkip(row) : null;
    },

    async createAgent(input) {
      const res = await client
        .from("agents")
        .insert({
          id: randomUUID(),
          workspace_id: workspaceId,
          created_by: userId,
          name: input.name,
          role: input.role,
          expert_name: input.expert_name ? input.expert_name : null,
          avatar: input.avatar,
        })
        .select("*")
        .single();
      return toAgent(check("insert agents", res) as AgentRow);
    },

    // updated_at is also set by agents_touch_updated_at_trg.
    async updateAgent(id, patch) {
      if (!isValidAgentId(id)) throw new AgentNotFoundError(id);
      const values: Partial<AgentRow> = { updated_at: new Date().toISOString() };
      if (patch.name !== undefined) values.name = patch.name;
      if (patch.role !== undefined) values.role = patch.role;
      if (patch.expert_name !== undefined) values.expert_name = patch.expert_name || null;
      if (patch.avatar !== undefined) values.avatar = patch.avatar;
      const res = await client.from("agents").update(values).eq("id", id).eq("workspace_id", workspaceId).select("*");
      const rows = check("update agents", res) as AgentRow[] | null;
      if (!rows || rows.length === 0) throw new AgentNotFoundError(id);
      return toAgent(rows[0]);
    },

    // sessions_agent_fkey (on delete set null (agent_id)) clears the link on the sessions.
    async deleteAgent(id) {
      if (!isValidAgentId(id)) return false;
      const res = await client.from("agents").delete().eq("id", id).eq("workspace_id", workspaceId).select("id");
      const rows = check("delete agents", res) as unknown[] | null;
      return !!rows && rows.length > 0;
    },
  };
  return store;
}
