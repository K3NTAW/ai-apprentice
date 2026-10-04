// Processes plus legacy Work Maps (T-0219). Pure, no I/O, safe in client components.
// Before slice (a), a confirmed Work Map lived only on its capture session. Such a session that is not linked to
// any process (sessions.process_id null) still counts: export, stats and Teach read the agent's confirmed,
// non-archived processes merged with these legacy sessions (agentWorkMaps).
import type { Process } from "@/lib/store/types";
import type { SessionDigest, WorkMap } from "@/lib/types";

export type LegacyLike = Pick<SessionDigest, "kind" | "workmap" | "agent_id" | "process_id">;

/** A capture session of an agent with an expert-confirmed Work Map that no process holds yet. */
export function isLegacyConfirmed<S extends LegacyLike>(s: S): s is S & { workmap: WorkMap; agent_id: string } {
  return s.kind === "capture" && !!s.agent_id && s.workmap?.confirmed_by_expert === true && !s.process_id;
}

export type AgentWorkMap = { source: "process" | "session"; id: string; title: string; workmap: WorkMap; at: string };

/**
 * The agent's confirmed Work Maps, newest first: confirmed, non-archived processes (titled by the process, dated
 * by created_at) and legacy confirmed sessions (dated by started_at). Other agents are ignored.
 */
export function agentWorkMaps(
  agentId: string,
  processes: readonly Pick<Process, "id" | "agent_id" | "title" | "workmap" | "confirmed" | "archived_at" | "created_at">[],
  sessions: readonly (LegacyLike & Pick<SessionDigest, "id" | "started_at">)[],
): AgentWorkMap[] {
  const fromProcesses = processes
    .filter((p) => p.agent_id === agentId && p.confirmed && !p.archived_at)
    .map((p): AgentWorkMap => ({ source: "process", id: p.id, title: p.title, workmap: p.workmap, at: p.created_at }));
  const fromSessions = sessions
    .filter((s) => s.agent_id === agentId && isLegacyConfirmed(s))
    .map((s): AgentWorkMap => ({ source: "session", id: s.id, title: s.workmap!.task, workmap: s.workmap!, at: s.started_at }));
  return [...fromProcesses, ...fromSessions].sort((a, b) => Date.parse(b.at) - Date.parse(a.at) || a.id.localeCompare(b.id));
}

