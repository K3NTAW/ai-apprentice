// Pure view models for the agent gallery (/agents), the agent page (/agents/[id]) and Learn (/learn). No I/O.
//
// Display rules (amendment A5):
// - stats.shortcuts null (no chords on confirmed Work Maps, count 0) shows "none yet"; a number shows as is.
// - Learners are named by the member label (own address for the signed-in user, else the first 8 chars of the
//   user id); a teach session without a known creator shows "unknown learner".
// - Repeat learners: the latest teach session per learner and process counts (same rule as the Work Map page);
//   mastery = mastered steps of those latest sessions over the steps of those processes.
// - Deleting an agent keeps its sessions; they become agentless (agent_id cleared by the store).
import { z } from "zod";
import { agentStats, type AgentStats } from "@/lib/agents/stats";
import type { CreatedBy, DashboardMember } from "@/lib/dashboard/summary";
import { AGENT_EXPERT_NAME_MAX, type Agent, type Guardrail, type Session } from "@/lib/types";
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
/** ?task is the optional first task title from the new agent flow. */
export const captureHref = (agentId: string, task?: string) =>
  `/capture?agent=${encodeURIComponent(agentId)}${task?.trim() ? `&task=${encodeURIComponent(task.trim())}` : ""}`;
/** ?agent is the agent of the new teach session; ?session is the source Work Map capture session. */
export const teachHref = (agentId: string, workmapSessionId: string) =>
  `/teach?agent=${encodeURIComponent(agentId)}&session=${encodeURIComponent(workmapSessionId)}`;
export const learnHref = (agentId?: string) => (agentId ? `/learn?agent=${encodeURIComponent(agentId)}` : "/learn");

export const statText = (n: number | null) => (n === null ? "none yet" : String(n));
export const expertLine = (agent: Pick<Agent, "expert_name">) =>
  agent.expert_name?.trim() ? `learns from ${agent.expert_name.trim()}` : "no expert named yet";

/** Expert initials for the card's 'learns from' dot: first letters of the first two words, else "?". */
export function initials(name: string | null | undefined): string {
  const parts = (name ?? "").trim().split(/\s+/).filter(Boolean);
  return parts.length ? parts.slice(0, 2).map((p) => p[0].toUpperCase()).join("") : "?";
}

/** 'Trained 2026-10-02' (Europe/Zurich date of the last capture), or 'Not trained yet'. */
export function lastText(lastTrained: string | null): string {
  const t = lastTrained ? Date.parse(lastTrained) : NaN;
  if (Number.isNaN(t)) return "Not trained yet";
  return `Trained ${new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Zurich" }).format(new Date(t))}`;
}

export type GalleryCard = {
  id: string;
  name: string;
  role: string;
  expert: string;
  /** The expert's name, or null when none is named yet. */
  expertName: string | null;
  initials: string;
  /** Ready to teach: at least one confirmed Work Map; otherwise the agent is still in training. */
  ready: boolean;
  last: string;
  avatar: Agent["avatar"];
  stats: AgentStats;
  href: string;
};

/** The empty gallery's avatar (GalleryEmpty.dc.html). */
export const EMPTY_AVATAR = { shape: "round", face: "calm", color: "#8E95A3", accent: "#62A9F3" } as const;

export type GalleryFilter = "all" | "ready" | "training";

/** Gallery search (name, role or expert, case-insensitive) and the filter tab. */
export function filterCards(cards: readonly GalleryCard[], query: string, filter: GalleryFilter): GalleryCard[] {
  const q = query.trim().toLowerCase();
  return cards.filter(
    (c) =>
      (filter === "all" || (filter === "ready") === c.ready) &&
      (!q || [c.name, c.role, c.expertName ?? ""].some((t) => t.toLowerCase().includes(q))),
  );
}

export function galleryCards(agents: readonly Agent[], sessions: readonly Session[]): GalleryCard[] {
  return [...agents]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((a) => {
      const stats = agentStats(a.id, sessions);
      const expertName = a.expert_name?.trim() || null;
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        expert: expertLine(a),
        expertName,
        initials: initials(expertName),
        ready: stats.processes > 0,
        last: lastText(stats.last_trained),
        avatar: a.avatar,
        stats,
        href: agentHref(a.id),
      };
    });
}

const confirmedOf = (agentId: string, sessions: readonly Session[]) =>
  sessions
    .filter((s) => s.agent_id === agentId && s.kind === "capture" && s.workmap?.confirmed_by_expert === true)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || a.id.localeCompare(b.id));

export type ProcessRow = { sessionId: string; task: string; counts: string; understood: number; date: string; href: string };

/** Mean of the per-step reason and guardrail scores, 0-100 (the 'Understood' bar). */
function understood(steps: readonly { scores?: { reason_captured?: number; guardrail_captured?: number } }[]): number {
  if (steps.length === 0) return 0;
  const sum = steps.reduce((n, st) => n + ((st.scores?.reason_captured ?? 0) + (st.scores?.guardrail_captured ?? 0)) / 2, 0);
  return Math.round((sum / steps.length) * 100);
}

/** The agent's confirmed Work Maps, newest first. */
export function agentProcesses(agentId: string, sessions: readonly Session[]): ProcessRow[] {
  return confirmedOf(agentId, sessions).map((s) => ({
    sessionId: s.id,
    task: s.workmap!.task || "Untitled capture",
    counts: countsLine(s.workmap!),
    understood: understood(s.workmap!.steps ?? []),
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
  sessionId: string;
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
        sessionId: s.id,
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

/** Learn: agents without a confirmed process yet, shown dimmed as 'Still training' (not startable). */
export function learnTraining(agents: readonly Agent[], sessions: readonly Session[]): GalleryCard[] {
  return galleryCards(agents, sessions).filter((c) => c.stats.processes === 0);
}

export type LearnProcess = ProcessRow & { teachHref: string; focus: string[]; practice: string[] };

/** Learn: the agent's confirmed processes, each linking to Teach, with the judgment-call steps the agent focuses on
 * and the screen entities to practise with. */
export function learnProcesses(agentId: string, sessions: readonly Session[]): LearnProcess[] {
  const maps = new Map(confirmedOf(agentId, sessions).map((s) => [s.id, s.workmap!]));
  return agentProcesses(agentId, sessions).map((p) => {
    const steps = maps.get(p.sessionId)?.steps ?? [];
    const focus = steps.filter((st) => st.is_judgment_call).map((st) => `Step ${st.n} · ${st.title}`);
    const practice = [...new Set(steps.map((st) => st.screen_moment.entity.trim()).filter(Boolean))];
    return { ...p, teachHref: teachHref(agentId, p.sessionId), focus, practice };
  });
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

/** Initials for the expert chip: 'Sabine Keller' -> SK, 'marco.bianchi@example.com' -> MB. */
export function expertInitials(value: string): string {
  const base = value.split("·")[0].split("@")[0].trim();
  const parts = base.split(/[\s._-]+/).filter(Boolean);
  return parts.slice(0, 2).map((p) => p[0]!.toUpperCase()).join("") || "?";
}

/** Display name from a member label: 'sabine.keller@example.com' -> 'Sabine Keller'. */
export function memberName(label: string): string {
  const local = label.split("@")[0];
  return local.split(/[._-]+/).filter(Boolean).map((p) => p[0]!.toUpperCase() + p.slice(1)).join(" ") || label;
}

/** A workspace member offered by the expert picker: label is the address or short id shown as a hint. */
export type ExpertOption = { userId: string; name: string; label: string; initial: string };
/** The expert as held by the new agent flow: a picked member carries its user id, a typed name does not. */
export type ExpertPick = { name: string; userId?: string };

/** Picker option from a member label; the name is the email local part, cut to AGENT_EXPERT_NAME_MAX (never the address). */
export function expertOption(member: { userId: string; label: string }): ExpertOption {
  const name = (member.label.includes("@") ? memberName(member.label) : member.label).slice(0, AGENT_EXPERT_NAME_MAX).trim();
  return { userId: member.userId, name, label: member.label, initial: expertInitials(name) };
}

/** The input value as the expert: an exact option name is that member (name plus user id), anything else is kept as typed. */
export function pickExpert(value: string, options: readonly ExpertOption[]): ExpertPick {
  const name = value.slice(0, AGENT_EXPERT_NAME_MAX);
  const member = options.find((o) => o.name === name.trim());
  return member ? { name: member.name, userId: member.userId } : { name };
}
