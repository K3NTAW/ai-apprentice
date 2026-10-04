// Agent status and process understanding (T-0209, slice e of the processes plan). Pure: no I/O.
//
// One rule, used by every consumer (AgentGallery cards and filter tabs, AgentDetail header, learnAgents,
// learnTraining, learnProcesses, the Processes tab):
// - understanding(workmap): mean over steps of (reason_captured + guardrail_captured) / 2, in 0..1.
//   A step without scores ('not scored') counts 0 for both. A guardrail the scorer skipped (a non-judgment step
//   with a reason) is already scored 1 by scoreWorkMap, so it counts fully. No steps: 0.
// - A process is ready when it is confirmed by the expert, not archived and understanding >= SCORE_THRESHOLD
//   (0.75 is ready, 0.74 is not).
// - Agent status: 'ready' with at least one ready process; else 'training' when it has any capture session or
//   process; else 'new'.
// Until the processes table exists (503 fallback), a process is a capture session of the agent with a Work Map
// (confirmed or not); archived_at is then always null.
import { SCORE_THRESHOLD, type Session, type WorkMap } from "@/lib/types";

export type AgentStatus = "ready" | "training" | "new";
export const STATUS_LABELS: Record<AgentStatus, string> = { ready: "Ready to teach", training: "Training", new: "New" };

type ScoredSteps = { steps?: readonly { scores?: { reason_captured?: number; guardrail_captured?: number } }[] };
const unit = (n: unknown) => (typeof n === "number" && Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

/** Understanding of a Work Map, 0..1 (see the header for the exact rule). */
export function understanding(workmap: ScoredSteps | null | undefined): number {
  const steps = workmap?.steps ?? [];
  if (steps.length === 0) return 0;
  const sum = steps.reduce((n, st) => n + (unit(st.scores?.reason_captured) + unit(st.scores?.guardrail_captured)) / 2, 0);
  return sum / steps.length;
}

/** Understanding as a whole percent for display. */
export const understandingPercent = (workmap: ScoredSteps | null | undefined) => Math.round(understanding(workmap) * 100);

/** Rounding guard: 0.75 computed from float scores (for example (0.7 + 0.8) / 2) must still pass. */
const EPS = 1e-9;

export type ProcessLike = { workmap: (ScoredSteps & Pick<WorkMap, "confirmed_by_expert">) | null | undefined; archived_at?: string | null };

export function isReadyProcess(p: ProcessLike): boolean {
  return !!p.workmap && p.workmap.confirmed_by_expert === true && !p.archived_at && understanding(p.workmap) + EPS >= SCORE_THRESHOLD;
}

/** Status of one agent from its sessions (fallback) and, when available, its processes. */
export function agentStatus(
  agentId: string,
  sessions: readonly Pick<Session, "agent_id" | "kind" | "workmap">[],
  processes: readonly (ProcessLike & { agent_id: string })[] = [],
): AgentStatus {
  const captures = sessions.filter((s) => s.agent_id === agentId && s.kind === "capture");
  const mine = processes.filter((p) => p.agent_id === agentId);
  const candidates: ProcessLike[] = mine.length > 0 ? mine : captures.map((s) => ({ workmap: s.workmap, archived_at: null }));
  if (candidates.some(isReadyProcess)) return "ready";
  return captures.length > 0 || mine.length > 0 ? "training" : "new";
}
