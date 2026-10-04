// Processes helpers that read the store (server only). See ./merge for the legacy Work Map rule.
// backfillProcesses turns legacy confirmed sessions into processes once. A run links each session
// (sessions.process_id), so a later run finds nothing left; two concurrent runs both see the session, but the store
// creates at most one process per source session (ProcessExistsError for the loser, which is skipped). A session
// whose process was deleted is skipped too (ProcessDeletedError, processes_tombstones): deleted processes stay deleted.
import {
  PROCESS_TITLE_MAX,
  ProcessDeletedError,
  ProcessesUnavailableError,
  ProcessExistsError,
  ProcessNotFoundError,
  SessionLinkedError,
  SessionNotFoundError,
  type ListProcessesOptions,
  type Process,
  type SessionStore,
} from "@/lib/store";
import { mergeWorkMaps } from "./combine";
import { matchProcess, type MatchDecide, type MatchResult } from "./match";
import { isLegacyConfirmed } from "./merge";

/** The processes, or none while migration 20261004030000_processes is not applied (callers fall back to sessions). */
export async function listProcessesOrNone(store: SessionStore, opts?: ListProcessesOptions): Promise<Process[]> {
  return store.listProcesses(opts).catch((err: unknown) => {
    if (err instanceof ProcessesUnavailableError) return [];
    throw err;
  });
}

/** A process title from a Work Map task: trimmed, at most PROCESS_TITLE_MAX characters, never empty. */
export function processTitle(task: string): string {
  return task.trim().replace(/\s+/g, " ").slice(0, PROCESS_TITLE_MAX).trim() || "Untitled process";
}

/**
 * One process per legacy confirmed session (oldest first), with the session as version 1's source and its
 * started_at as created_at (the order stays as it was). Returns the processes this call created.
 * Idempotent and safe to run concurrently. ProcessesUnavailableError while the migration is missing.
 */
export async function backfillProcesses(store: SessionStore, opts: { agent_id?: string } = {}): Promise<Process[]> {
  const legacy = (await store.listSessionDigests())
    .filter(isLegacyConfirmed)
    .filter((s) => opts.agent_id === undefined || s.agent_id === opts.agent_id)
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || a.id.localeCompare(b.id));
  const created: Process[] = [];
  for (const s of legacy) {
    try {
      created.push(
        await store.createProcess({ agent_id: s.agent_id, title: processTitle(s.workmap.task), workmap: s.workmap, source_session_id: s.id, backfill: true }),
      );
    } catch (err) {
      // Another run (or an edit) took the session meanwhile, or its process was deleted: skip it.
      if (!(err instanceof ProcessExistsError) && !(err instanceof ProcessDeletedError) && !(err instanceof SessionLinkedError)) throw err;
    }
  }
  return created;
}

// Slice (c): the end of the debrief. suggestForSession runs the match decision for a confirmed capture session;
// saveFromSession writes the expert's choice. Every Work Map change goes through createProcess ('trained') or
// updateProcess ('extended' / 'replaced'), so each writes a process_versions row with the session as its source;
// the previous Work Map stays in process_versions.

export type SessionChoice = "add" | "replace" | "new";

export class SessionNotConfirmedError extends Error {
  readonly code = "session_not_confirmed";
  constructor(id: string) {
    super(`session ${id} has no confirmed Work Map of an agent`);
    this.name = "SessionNotConfirmedError";
  }
}

async function confirmedSession(store: SessionStore, sessionId: string) {
  const s = await store.getSession(sessionId);
  if (!s) throw new SessionNotFoundError(sessionId);
  if (s.kind !== "capture" || !s.agent_id || s.workmap?.confirmed_by_expert !== true) throw new SessionNotConfirmedError(sessionId);
  return { session: s, agentId: s.agent_id, workmap: s.workmap };
}

export type Suggestion = {
  /** The process the session is linked to already (saved before), else null. */
  linked: Pick<Process, "id" | "title" | "version"> | null;
  match: MatchResult;
  candidates: Pick<Process, "id" | "title" | "version">[];
};

const brief = (p: Process) => ({ id: p.id, title: p.title, version: p.version });

export async function suggestForSession(store: SessionStore, sessionId: string, decideFn?: MatchDecide): Promise<Suggestion> {
  const { session, agentId, workmap } = await confirmedSession(store, sessionId);
  const processes = await store.listProcesses({ agent_id: agentId });
  const linked = session.process_id ? (processes.find((p) => p.id === session.process_id) ?? null) : null;
  const others = processes.filter((p) => p.id !== linked?.id);
  return { linked: linked && brief(linked), match: await matchProcess(workmap, others, decideFn), candidates: others.map(brief) };
}

export type SaveInput = { session_id: string; choice: SessionChoice; process_id?: string; expected_version?: number; preview?: boolean };
export type SaveResult = { process: Process | null; changes: string[]; conflicts: string[] };

/** preview: the 'Add to it' merge without writing (process null). */
export async function saveFromSession(store: SessionStore, input: SaveInput): Promise<SaveResult> {
  const { agentId, workmap } = await confirmedSession(store, input.session_id);
  if (input.choice === "new") {
    if (input.preview) return { process: null, changes: [], conflicts: [] };
    const process = await store.createProcess({ agent_id: agentId, title: processTitle(workmap.task), workmap, source_session_id: input.session_id });
    return { process, changes: [`New process "${process.title}" saved.`], conflicts: [] };
  }
  const id = input.process_id ?? "";
  const current = await store.getProcess(id);
  if (!current || current.agent_id !== agentId) throw new ProcessNotFoundError(id);
  const expected_version = input.expected_version ?? current.version;
  if (input.choice === "replace") {
    if (input.preview) return { process: null, changes: [], conflicts: [] };
    const process = await store.updateProcess(id, { workmap, change_kind: "replaced", source_session_id: input.session_id, expected_version });
    return { process, changes: [`"${current.title}" replaced; version ${current.version} is kept in the history.`], conflicts: [] };
  }
  const merged = mergeWorkMaps(current.workmap, workmap);
  if (input.preview) return { process: null, changes: merged.changes, conflicts: merged.conflicts };
  const process = await store.updateProcess(id, { workmap: merged.workmap, change_kind: "extended", source_session_id: input.session_id, expected_version });
  return { process, changes: merged.changes, conflicts: merged.conflicts };
}
