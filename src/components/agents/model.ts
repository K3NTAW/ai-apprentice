// Pure view models for the agent gallery (/agents), the agent page (/agents/[id]) and Learn (/learn). No I/O.
//
// Display rules (amendment A5):
// - stats.shortcuts null (no chords on confirmed Work Maps, count 0) shows "none yet"; a number shows as is.
// - Learners are named by the member label (own address for the signed-in user, else the first 8 chars of the
//   user id); a teach session without a known creator shows "unknown learner".
// - Repeat learners: the latest teach session per learner and process counts (same rule as the Work Map page);
//   mastery = mastered steps of those latest sessions over the steps of those processes.
// - Deleting an agent keeps its sessions; they become agentless (agent_id cleared by the store).
// - Processes (T-0225): cards, header stats, filter tabs, the Processes, Shortcuts and Guardrails tabs and Learn
//   read the agent's Work Maps from agentWorkMaps (lib/processes/merge): confirmed, non-archived processes merged
//   with legacy confirmed capture sessions not linked to a process. processes defaults to none (migration missing,
//   previews), which leaves the session rule. Links (/map, Teach) go to an entry's session: the process's newest
//   linked capture session; a process without one is listed but not startable in Learn.
import { z } from "zod";
import { agentStats, type AgentStats } from "@/lib/agents/stats";
import { agentStatus, isReadyProcess, understandingPercent, type AgentStatus } from "@/lib/agents/status";
import type { CreatedBy, DashboardMember } from "@/lib/dashboard/summary";
import { agentWorkMaps, type AgentWorkMap } from "@/lib/processes/merge";
import type { Process } from "@/lib/store/types";
import { AGENT_EXPERT_NAME_MAX, type Agent, type Guardrail, type Session, type SessionDigest } from "@/lib/types";
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
/**
 * ?agent is the agent of the new teach session; ?session is the source Work Map capture session; ?process, when the
 * Work Map is a process, makes Teach play the process's current Work Map (edits included).
 */
export const teachHref = (agentId: string, workmapSessionId: string, processId?: string | null) =>
  `/teach?agent=${encodeURIComponent(agentId)}&session=${encodeURIComponent(workmapSessionId)}${processId ? `&process=${encodeURIComponent(processId)}` : ""}`;
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
  /** Shared status rule (lib/agents/status): ready, training or new. */
  status: AgentStatus;
  /** Ready to teach: a confirmed, non-archived process at or above the 75% understanding bar. */
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
      (filter === "all" || filter === c.status) &&
      (!q || [c.name, c.role, c.expertName ?? ""].some((t) => t.toLowerCase().includes(q))),
  );
}

/** The processes the view models read (a Process from the store fits). */
export type ModelProcess = Pick<Process, "id" | "agent_id" | "title" | "workmap" | "confirmed" | "archived_at" | "created_at">;

export function galleryCards(agents: readonly Agent[], sessions: readonly SessionDigest[], processes: readonly ModelProcess[] = []): GalleryCard[] {
  return [...agents]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((a) => {
      const stats = agentStats(a.id, sessions, processes);
      const expertName = a.expert_name?.trim() || null;
      const status = agentStatus(a.id, sessions, processes);
      return {
        id: a.id,
        name: a.name,
        role: a.role,
        expert: expertLine(a),
        expertName,
        initials: initials(expertName),
        status,
        ready: status === "ready",
        last: lastText(stats.last_trained),
        avatar: a.avatar,
        stats,
        href: agentHref(a.id),
      };
    });
}

/** The agent's confirmed Work Maps, newest first: processes merged with legacy sessions (agentWorkMaps). */
const confirmedOf = (agentId: string, sessions: readonly SessionDigest[], processes: readonly ModelProcess[]) =>
  agentWorkMaps(agentId, processes, sessions);

const taskOf = (m: AgentWorkMap) => m.title || "Untitled capture";
const mapHref = (agentId: string, m: AgentWorkMap, hash = "") =>
  m.sessionId ? `/map/${encodeURIComponent(m.sessionId)}${hash}` : agentHref(agentId);

/** understood: the shared understanding score as 0-100 (the 'Understood' bar); ready: startable in Learn. */
export type ProcessRow = {
  sessionId: string;
  task: string;
  counts: string;
  understood: number;
  ready: boolean;
  date: string;
  href: string;
  /** The process id when the entry is a process (editable on /processes/<id>), null for a legacy session. */
  processId: string | null;
};
/** The process page: rename, edit steps and guardrails, archive, delete, versions, training entry points. */
export const processHref = (id: string) => `/processes/${encodeURIComponent(id)}`;

/** The agent's confirmed Work Maps, newest first. sessionId: the entry's session, else the process id. */
export function agentProcesses(agentId: string, sessions: readonly SessionDigest[], processes: readonly ModelProcess[] = []): ProcessRow[] {
  return confirmedOf(agentId, sessions, processes).map((m) => ({
    sessionId: m.sessionId ?? m.id,
    task: taskOf(m),
    counts: countsLine(m.workmap),
    understood: understandingPercent(m.workmap),
    ready: isReadyProcess({ workmap: m.workmap, archived_at: null }),
    date: formatZurich(m.at),
    href: mapHref(agentId, m),
    processId: m.source === "process" ? m.id : null,
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
export function agentGuardrails(agentId: string, sessions: readonly SessionDigest[], processes: readonly ModelProcess[] = []): GuardrailRow[] {
  return confirmedOf(agentId, sessions, processes).flatMap((m) =>
    m.workmap.steps.flatMap((step) =>
      step.guardrails.map((g) => ({
        rule: g.rule,
        kind: g.kind,
        quote: g.quote?.trim() || null,
        task: taskOf(m),
        step: `${step.n}. ${step.title}`,
        at: formatT(step.screen_moment.t),
        href: mapHref(agentId, m, `#step-${step.n}`),
        sessionId: m.sessionId ?? m.id,
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
export function agentShortcuts(agentId: string, sessions: readonly SessionDigest[], processes: readonly ModelProcess[] = []): ShortcutRow[] {
  const seen = new Set<string>();
  const rows: ShortcutRow[] = [];
  const add = (m: AgentWorkMap, raw: unknown, n: number | undefined) => {
    const p = ShortcutSchema.safeParse(raw);
    if (!p.success) return;
    const key = `${p.data.chord.toLowerCase()}|${(p.data.app ?? "").toLowerCase()}`;
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({
      chord: p.data.chord,
      app: p.data.app ?? "",
      what: p.data.what ?? "",
      why: p.data.why ?? "",
      task: taskOf(m),
      href: mapHref(agentId, m, n === undefined ? "" : `#step-${n}`),
    });
  };
  for (const m of confirmedOf(agentId, sessions, processes)) {
    // Contract: WorkMap.shortcuts (effect and a quoted why), the same list the agent stats count.
    for (const sc of m.workmap.shortcuts ?? []) add(m, { chord: sc.chord, app: sc.app, what: sc.effect, why: sc.why?.quote }, sc.step);
    // Older maps carried shortcuts per step.
    for (const step of m.workmap.steps) {
      const list = (step as { shortcuts?: unknown }).shortcuts;
      if (!Array.isArray(list)) continue;
      for (const raw of list) add(m, raw, step.n);
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

const teachTime = (s: SessionDigest) => Date.parse(s.teach?.finished_at ?? s.ended_at ?? s.started_at) || 0;

/** Who practised with this agent and their mastery (latest session per learner and process). */
export function agentLearners(
  agentId: string,
  sessions: readonly SessionDigest[],
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

/** Learn: only agents with at least one ready process are offered. */
export function learnAgents(agents: readonly Agent[], sessions: readonly SessionDigest[], processes: readonly ModelProcess[] = []): GalleryCard[] {
  return galleryCards(agents, sessions, processes).filter((c) => c.ready);
}

/** Learn: agents without a ready process yet, shown dimmed as 'Still training' (not startable). */
export function learnTraining(agents: readonly Agent[], sessions: readonly SessionDigest[], processes: readonly ModelProcess[] = []): GalleryCard[] {
  return galleryCards(agents, sessions, processes).filter((c) => !c.ready);
}

export type LearnProcess = ProcessRow & { teachHref: string; focus: string[]; practice: string[] };

/** Learn: the agent's confirmed processes (ready ones startable, the rest dimmed with their %), each linking to Teach, with the judgment-call steps the agent focuses on
 * and the screen entities to practise with. */
/** Processes reach Teach through their newest linked capture session; one without a session is not listed. */
export function learnProcesses(agentId: string, sessions: readonly SessionDigest[], processes: readonly ModelProcess[] = []): LearnProcess[] {
  const linked = confirmedOf(agentId, sessions, processes).filter((m) => m.sessionId !== null);
  const maps = new Map(linked.map((m) => [m.sessionId!, m]));
  return agentProcesses(agentId, sessions, processes).filter((p) => maps.has(p.sessionId)).map((p) => {
    const m = maps.get(p.sessionId)!;
    const steps = m.workmap.steps;
    const focus = steps.filter((st) => st.is_judgment_call).map((st) => `Step ${st.n} · ${st.title}`);
    const practice = [...new Set(steps.map((st) => st.screen_moment.entity.trim()).filter(Boolean))];
    return { ...p, teachHref: teachHref(agentId, p.sessionId, m.source === "process" ? m.id : null), focus, practice };
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
