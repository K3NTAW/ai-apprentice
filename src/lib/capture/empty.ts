// Empty capture runs (processes slice b, T-0213). Pure, no I/O, safe in client components.
// A capture that ended is EMPTY when it lasted under EMPTY_MIN_SECONDS, or when it has fewer than EMPTY_MIN_EVENTS
// screen events and no answered question (no Q&A pair with an answer). An empty run never builds a Work Map
// (/api/workmap answers 409 empty_session) and so never becomes a process. The sidebar shows it as 'No work
// recorded', the debrief page offers Delete, and the retention cron purges it EMPTY_PURGE_MS after it ended.
// The mark is derived, never stored: sessions from before this rule (no events, no Work Map) read as empty the
// same way, which is the one-time cleanup. A session with a Work Map that has steps, or one linked to a process,
// is never empty; a live session is never empty either.
import type { QAPair, Session, WorkMap } from "@/lib/types";

export const EMPTY_MIN_EVENTS = 3;
export const EMPTY_MIN_SECONDS = 30;
export const EMPTY_PURGE_MS = 24 * 60 * 60 * 1000;
export const NO_WORK_RECORDED = "No work recorded";

/** What the rule reads. events: screen events of the run; answered: Q&A pairs with an answer; work: hasWork. */
export type RunFacts = {
  kind: Session["kind"];
  started_at: string;
  ended_at?: string | null;
  events: number;
  answered: number;
  work: boolean;
  process_id?: string | null;
};

/** A Work Map with at least one step: recorded work, kept whatever the run's length. */
export const hasWork = (workmap: Pick<WorkMap, "steps"> | null | undefined) => !!workmap && workmap.steps.length > 0;

export const isAnswered = (qa: Pick<QAPair, "answer">) => !!qa.answer?.trim();

/** The thresholds alone: an ended run under 30 s, or with < 3 events and no answered question. */
export function isEmptyRun(f: Pick<RunFacts, "started_at" | "ended_at" | "events" | "answered">): boolean {
  if (!f.ended_at) return false;
  const ms = Date.parse(f.ended_at) - Date.parse(f.started_at);
  if (Number.isFinite(ms) && ms < EMPTY_MIN_SECONDS * 1000) return true;
  return f.events < EMPTY_MIN_EVENTS && f.answered === 0;
}

/** An ended capture with no recorded work and no process that meets the empty thresholds. */
export function isEmptyCapture(f: RunFacts): boolean {
  return f.kind === "capture" && !f.work && !f.process_id && isEmptyRun(f);
}

export function runFacts(s: Pick<Session, "kind" | "started_at" | "ended_at" | "events" | "qa" | "workmap" | "process_id">): RunFacts {
  return {
    kind: s.kind,
    started_at: s.started_at,
    ended_at: s.ended_at,
    events: s.events.length,
    answered: s.qa.filter(isAnswered).length,
    work: hasWork(s.workmap),
    process_id: s.process_id,
  };
}

export const isEmptySession = (s: Parameters<typeof runFacts>[0]) => isEmptyCapture(runFacts(s));

/** Empty and ended at least EMPTY_PURGE_MS before now: the retention cron deletes it. */
export function isPurgeable(f: RunFacts, nowMs: number): boolean {
  if (!isEmptyCapture(f) || !f.ended_at) return false;
  const ended = Date.parse(f.ended_at);
  return Number.isFinite(ended) && nowMs - ended >= EMPTY_PURGE_MS;
}
