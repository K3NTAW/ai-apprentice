// Processes helpers that read the store (server only). See ./merge for the legacy Work Map rule.
// backfillProcesses turns legacy confirmed sessions into processes once; it is idempotent because createProcess
// links the session (sessions.process_id), so a second run finds nothing left to backfill.
import { PROCESS_TITLE_MAX, ProcessesUnavailableError, type ListProcessesOptions, type Process, type SessionStore } from "@/lib/store";
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
 * One process per legacy confirmed session (oldest first), with the session as version 1's source.
 * Idempotent. ProcessesUnavailableError while the migration is missing.
 */
export async function backfillProcesses(store: SessionStore, opts: { agent_id?: string } = {}): Promise<Process[]> {
  const legacy = (await store.listSessionDigests())
    .filter(isLegacyConfirmed)
    .filter((s) => opts.agent_id === undefined || s.agent_id === opts.agent_id)
    .sort((a, b) => Date.parse(a.started_at) - Date.parse(b.started_at) || a.id.localeCompare(b.id));
  const created: Process[] = [];
  for (const s of legacy)
    created.push(await store.createProcess({ agent_id: s.agent_id, title: processTitle(s.workmap.task), workmap: s.workmap, source_session_id: s.id }));
  return created;
}
