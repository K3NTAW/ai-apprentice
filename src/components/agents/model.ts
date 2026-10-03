// Pure view models for the agent gallery (/agents), the agent page (/agents/[id]) and Learn (/learn). No I/O.
//
// Display rules (amendment A5):
// - stats.shortcuts null (no chords recorded yet) shows "none yet"; a number shows as is.
// - Learners are named by the member label (own address for the signed-in user, else the first 8 chars of the
//   user id); a teach session without a known creator shows "unknown learner".
// - Repeat learners: the latest teach session per learner and process counts (same rule as the Work Map page);
//   mastery = mastered steps of those latest sessions over the steps of those processes.
// - Deleting an agent keeps its sessions; they become agentless (agent_id cleared by the store).
import { z } from "zod";
import { agentStats, type AgentStats } from "@/lib/agents/stats";
import type { CreatedBy, DashboardMember } from "@/lib/dashboard/summary";
import type { Agent, Guardrail, Session } from "@/lib/types";
import { countsLine, formatT, formatZurich } from "@/lib/workmap/view";

export const AGENT_TABS = ["processes", "shortcuts", "guardrails", "learners", "settings"] as const;
export type AgentTab = (typeof AGENT_TABS)[number];
export const TAB_LABELS: Record<AgentTab, string> = {
  processes: "Processes",
  shortcuts: "Shortcuts",
  guardrails: "Guardrails",
  learners: "Learners",
  settings: "Settings",
};

export function parseTab(value: unknown): AgentTab {
  return typeof value === "string" && (AGENT_TABS as readonly string[]).includes(value) ? (value as AgentTab) : "processes";
}

const ID = /^[0-9a-zA-Z-]{1,64}$/;
/** Query ids (?agent, ?session) pass only as short [0-9a-zA-Z-] strings, else null. */
export function parseId(value: unknown): string | null {
  return typeof value === "string" && ID.test(value) ? value : null;
}

export const agentHref = (id: string, tab?: AgentTab) =>
  `/agents/${encodeURIComponent(id)}${tab && tab !== "processes" ? `?tab=${tab}` : ""}`;
export const captureHref = (agentId: string) => `/capture?agent=${encodeURIComponent(agentId)}`;
/** ?agent is the agent of the new teach session; ?session is the source Work Map capture session. */
export const teachHref = (agentId: string, workmapSessionId: string) =>
  `/teach?agent=${encodeURIComponent(agentId)}&session=${encodeURIComponent(workmapSessionId)}`;
export const learnHref = (agentId?: string) => (agentId ? `/learn?agent=${encodeURIComponent(agentId)}` : "/learn");

export const statText = (n: number | null) => (n === null ? "none yet" : String(n));
export const expertLine = (agent: Pick<Agent, "expert_name">) =>
  agent.expert_name?.trim() ? `learns from ${agent.expert_name.trim()}` : "no expert named yet";

export type GalleryCard = {
  id: string;
  name: string;
  role: string;
  expert: string;
  avatar: Agent["avatar"];
  stats: AgentStats;
  href: string;
};

export function galleryCards(agents: readonly Agent[], sessions: readonly Session[]): GalleryCard[] {
  return [...agents]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      role: a.role,
      expert: expertLine(a),
      avatar: a.avatar,
      stats: agentStats(a.id, sessions),
      href: agentHref(a.id),
    }));
}

const confirmedOf = (agentId: string, sessions: readonly Session[]) =>
  sessions
    .filter((s) => s.agent_id === agentId && s.kind === "capture" && s.workmap?.confirmed_by_expert === true)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || a.id.localeCompare(b.id));

export type ProcessRow = { sessionId: string; task: string; counts: string; date: string; href: string };

/** The agent's confirmed Work Maps, newest first. */
export function agentProcesses(agentId: string, sessions: readonly Session[]): ProcessRow[] {
  return confirmedOf(agentId, sessions).map((s) => ({
    sessionId: s.id,
    task: s.workmap!.task || "Untitled capture",
    counts: countsLine(s.workmap!),
    date: formatZurich(s.started_at),
    href: `/map/${encodeURIComponent(s.id)}`,
  }));
}

export type GuardrailRow = {
  rule: string;
  kind: Guardrail["kind"];
  quote: string | null;
  task: string;
  step: string;
  at: string;
  href: string;
};

/** Every guardrail across the agent's confirmed Work Maps, with the expert quote and a link to the screen moment. */
export function agentGuardrails(agentId: string, sessions: readonly Session[]): GuardrailRow[] {
  return confirmedOf(agentId, sessions).flatMap((s) =>
    s.workmap!.steps.flatMap((step) =>
      step.guardrails.map((g) => ({
        rule: g.rule,
        kind: g.kind,
        quote: g.quote?.trim() || null,
        task: s.workmap!.task || "Untitled capture",
        step: `${step.n}. ${step.title}`,
        at: formatT(step.screen_moment.t),
        href: `/map/${encodeURIComponent(s.id)}#step-${step.n}`,
      })),
    ),
  );
}

// Work Map shortcut shape, recorded by the shortcuts task: steps[].shortcuts[] = {chord, app, what, why}.
// Read defensively here because the shared WorkMap type does not carry it yet; malformed entries are skipped.
const ShortcutSchema = z.object({
  chord: z.string().trim().min(1).max(60),
  app: z.string().max(120).optional(),
  what: z.string().max(280).optional(),
  why: z.string().max(280).optional(),
});

export type ShortcutRow = { chord: string; app: string; what: string; why: string; task: string; href: string };

/** Glossary of the agent's shortcuts from its confirmed Work Maps; one row per chord and app, first seen wins. */
export function agentShortcuts(agentId: string, sessions: readonly Session[]): ShortcutRow[] {
  const seen = new Set<string>();
  const rows: ShortcutRow[] = [];
  for (const s of confirmedOf(agentId, sessions))
    for (const step of s.workmap!.steps) {
      const list = (step as { shortcuts?: unknown }).shortcuts;
      if (!Array.isArray(list)) continue;
      for (const raw of list) {
        const p = ShortcutSchema.safeParse(raw);
        if (!p.success) continue;
        const key = `${p.data.chord.toLowerCase()}|${(p.data.app ?? "").toLowerCase()}`;
        if (seen.has(key)) continue;
        seen.add(key);
        rows.push({
          chord: p.data.chord,
          app: p.data.app ?? "",
          what: p.data.what ?? "",
          why: p.data.why ?? "",
          task: s.workmap!.task || "Untitled capture",
          href: `/map/${encodeURIComponent(s.id)}#step-${step.n}`,
        });
      }
    }
  return rows;
}

export type LearnerProcess = {
  workmapSessionId: string;
  task: string;
  date: string;
  mastered: number;
  steps: number;
  interventions: number;
  finished: boolean;
};
export type LearnerRow = { key: string; label: string; mastered: number; steps: number; processes: LearnerProcess[] };

const teachTime = (s: Session) => Date.parse(s.teach?.finished_at ?? s.ended_at ?? s.started_at) || 0;

/** Who practised with this agent and their mastery (latest session per learner and process). */
export function agentLearners(
  agentId: string,
  sessions: readonly Session[],
  members: readonly DashboardMember[],
  createdBy: CreatedBy,
): LearnerRow[] {
  const byId = new Map(sessions.map((s) => [s.id, s]));
  const labels = new Map(members.map((m) => [m.userId, m.label]));
  const teach = sessions.filter((s) => s.agent_id === agentId && s.kind === "teach" && s.teach).sort((a, b) => teachTime(b) - teachTime(a));
  const learners = new Map<string, LearnerRow>();
  const seen = new Set<string>();
  for (const t of teach) {
    const who = createdBy[t.id] ?? null;
    const key = who ?? `session:${t.id}`;
    const mapId = t.teach!.workmap_session_id;
    if (seen.has(`${key}|${mapId}`)) continue;
    seen.add(`${key}|${mapId}`);
    const map = byId.get(mapId);
    const steps = map?.workmap?.steps.length ?? 0;
    const mastered = steps ? Math.min(new Set(t.teach!.mastered).size, steps) : new Set(t.teach!.mastered).size;
    const row = learners.get(key) ?? {
      key,
      label: who ? (labels.get(who) ?? who.slice(0, 8)) : "unknown learner",
      mastered: 0,
      steps: 0,
      processes: [],
    };
    row.processes.push({
      workmapSessionId: mapId,
      task: map?.workmap?.task || "Untitled capture",
      date: formatZurich(t.teach!.finished_at ?? t.ended_at ?? t.started_at),
      mastered,
      steps,
      interventions: t.teach!.interventions,
      finished: !!t.teach!.finished_at,
    });
    row.mastered += mastered;
    row.steps += steps;
    learners.set(key, row);
  }
  return [...learners.values()].sort((a, b) => a.label.localeCompare(b.label));
}

export const masteryText = (mastered: number, steps: number) =>
  steps > 0 ? `${mastered} of ${steps} steps mastered (${Math.round((mastered / steps) * 100)}%)` : `${mastered} steps mastered`;

/** Learn: only agents with at least one confirmed process are offered. */
export function learnAgents(agents: readonly Agent[], sessions: readonly Session[]): GalleryCard[] {
  return galleryCards(agents, sessions).filter((c) => c.stats.processes > 0);
}

/** Learn: the agent's confirmed processes, each linking to Teach. */
export function learnProcesses(agentId: string, sessions: readonly Session[]): (ProcessRow & { teachHref: string })[] {
  return agentProcesses(agentId, sessions).map((p) => ({ ...p, teachHref: teachHref(agentId, p.sessionId) }));
}

/**
 * Teach guard (amendment A4): the source Work Map session must exist, be a confirmed capture and belong to the agent.
 * Returns an error text for the page, or null when it is fine.
 */
export function teachSourceError(agentId: string, source: Pick<Session, "kind" | "agent_id" | "workmap"> | null): string | null {
  if (!source) return "This Work Map was not found in your workspace.";
  if (source.kind !== "capture" || !source.workmap) return "This session has no Work Map to practise.";
  if (source.agent_id !== agentId) return "This Work Map belongs to a different agent. Pick the process again from Learn.";
  return null;
}
