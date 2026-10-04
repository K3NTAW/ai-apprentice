// Processes plus legacy Work Maps (T-0219). Pure, no I/O, safe in client components.
// Before slice (a), a confirmed Work Map lived only on its capture session. Such a session that is not linked to
// any process (sessions.process_id null) still counts: export, stats, the agent cards, header and filter tabs, Learn
// and Teach read the agent's confirmed, non-archived processes merged with these legacy sessions (agentWorkMaps).
// Teach starts from a capture session: a process is taught through its newest linked capture session (sessionId),
// with the process's current Work Map (teachWorkMapSessions).
// A Work Map without steps is no recorded work (lib/capture/empty hasWork, the empty-run rule): such a session is
// never a legacy process (and never backfilled), and such a process never shows in the lists (T-0242).
import { hasWork } from "@/lib/capture/empty";
import type { Process } from "@/lib/store/types";
import type { SessionDigest, WorkMap } from "@/lib/types";

export type LegacyLike = Pick<SessionDigest, "kind" | "workmap" | "agent_id" | "process_id">;

/** A capture session of an agent with an expert-confirmed Work Map with steps that no process holds yet. */
export function isLegacyConfirmed<S extends LegacyLike>(s: S): s is S & { workmap: WorkMap; agent_id: string } {
  return s.kind === "capture" && !!s.agent_id && s.workmap?.confirmed_by_expert === true && hasWork(s.workmap) && !s.process_id;
}

/**
 * sessionId: the capture session Teach and the Work Map page open; for a process its newest linked capture session,
 * null when no session is linked to it (it cannot be taught yet).
 */
export type AgentWorkMap = { source: "process" | "session"; id: string; title: string; workmap: WorkMap; at: string; sessionId: string | null };

type MergeSession = LegacyLike & Pick<SessionDigest, "id" | "started_at">;

const newestFirst = (a: { started_at: string; id: string }, b: { started_at: string; id: string }) =>
  Date.parse(b.started_at) - Date.parse(a.started_at) || a.id.localeCompare(b.id);

/** process id -> its newest linked capture session id. */
function anchors(sessions: readonly MergeSession[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const s of [...sessions].filter((x) => x.kind === "capture" && x.process_id).sort(newestFirst))
    if (!out.has(s.process_id!)) out.set(s.process_id!, s.id);
  return out;
}

/**
 * The agent's confirmed Work Maps with steps, newest first: confirmed, non-archived processes (titled by the process, dated
 * by created_at) and legacy confirmed sessions (dated by started_at). Other agents are ignored.
 */
export function agentWorkMaps(
  agentId: string,
  processes: readonly Pick<Process, "id" | "agent_id" | "title" | "workmap" | "confirmed" | "archived_at" | "created_at">[],
  sessions: readonly MergeSession[],
): AgentWorkMap[] {
  const linked = anchors(sessions);
  const fromProcesses = processes
    .filter((p) => p.agent_id === agentId && p.confirmed && !p.archived_at && hasWork(p.workmap))
    .map((p): AgentWorkMap => ({ source: "process", id: p.id, title: p.title, workmap: p.workmap, at: p.created_at, sessionId: linked.get(p.id) ?? null }));
  const fromSessions = sessions
    .filter((s) => s.agent_id === agentId && isLegacyConfirmed(s))
    .map((s): AgentWorkMap => ({ source: "session", id: s.id, title: s.workmap!.task, workmap: s.workmap!, at: s.started_at, sessionId: s.id }));
  return [...fromProcesses, ...fromSessions].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
}


/**
 * Teach's view of the capture sessions (GET /api/workmaps?confirmed=1): a session linked to a process shows that
 * process's current Work Map (task = the process title) when it is the process's newest linked session and the
 * process is confirmed and not archived; its other linked sessions show no Work Map, so a process is offered once.
 * Unlinked (legacy) sessions are unchanged. Without processes (migration missing) the sessions come back as they are.
 */
export function teachWorkMapSessions<S extends MergeSession>(
  sessions: readonly S[],
  processes: readonly Pick<Process, "id" | "title" | "workmap" | "confirmed" | "archived_at">[],
): S[] {
  if (processes.length === 0) return [...sessions];
  const byId = new Map(processes.map((p) => [p.id, p]));
  const linked = anchors(sessions);
  return sessions.map((s) => {
    if (s.kind !== "capture" || !s.process_id) return s;
    const p = byId.get(s.process_id);
    if (!p) return s;
    if (linked.get(p.id) !== s.id || !p.confirmed || p.archived_at) return { ...s, workmap: undefined };
    return { ...s, workmap: { ...p.workmap, task: p.title } };
  });
}
