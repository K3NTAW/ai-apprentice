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
  SessionLinkedError,
  type ListProcessesOptions,
  type Process,
  type SessionStore,
} from "@/lib/store";
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
