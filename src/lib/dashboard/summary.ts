// Pure builder for the control room (/dashboard) and the Work Map Learners section.
// Input: full sessions from the store, workspace members and who created each session (RLS applies upstream).
import type { Session, SessionDigest, WorkMap } from "@/lib/types";
import { countsLine, formatZurich } from "@/lib/workmap/view";

export type WorkflowStatus = "capturing" | "debrief pending" | "confirmed";

export type DashboardMember = { userId: string; label: string; role: string };

export type WorkflowRow = {
  sessionId: string;
  task: string;
  status: WorkflowStatus;
  /** Empty while no Work Map exists yet. */
  counts: string;
  /** "YYYY-MM-DD HH:mm", Europe/Zurich, 24 h. */
  updated: string;
  href: string;
};

export type ExpertWorkflows = { expert: string; workflows: WorkflowRow[] };

export type MasteryRow = {
  workmapSessionId: string;
  task: string;
  learner: string;
  /** "YYYY-MM-DD HH:mm", Europe/Zurich, 24 h. */
  date: string;
  mastered: string[];
  practiceNext: string[];
  interventions: number;
  finished: boolean;
};

export type LearnerSummary = { userId: string; label: string; mastery: MasteryRow[] };

export type DashboardSummary = { experts: ExpertWorkflows[]; learners: LearnerSummary[] };

/** session id -> user id that created it (null or missing when unknown, e.g. local mode). */
export type CreatedBy = Readonly<Record<string, string | null | undefined>>;

const time = (iso: string | undefined) => {
  const n = iso ? Date.parse(iso) : NaN;
  return Number.isNaN(n) ? 0 : n;
};

const lastUpdate = (s: SessionDigest) => (time(s.ended_at) > time(s.started_at) ? s.ended_at! : s.started_at);

export function workflowStatus(s: SessionDigest): WorkflowStatus {
  if (s.workmap?.confirmed_by_expert === true) return "confirmed";
  if (s.workmap || s.ended_at) return "debrief pending";
  return "capturing";
}

/** Step ids are matched against the step number and the title; unknown ids are shown as is. */
function stepLabels(ids: string[], workmap: WorkMap | undefined): string[] {
  return ids.map((id) => workmap?.steps.find((st) => String(st.n) === id || st.title === id)?.title ?? id);
}

export function expertWorkflows(sessions: SessionDigest[]): ExpertWorkflows[] {
  const byExpert = new Map<string, { latest: number; rows: { t: number; row: WorkflowRow }[] }>();
  for (const s of sessions) {
    if (s.kind !== "capture") continue;
    const expert = s.workmap?.expert || s.expert || "unknown";
    const t = time(lastUpdate(s));
    const row: WorkflowRow = {
      sessionId: s.id,
      task: s.workmap?.task || "Untitled capture",
      status: workflowStatus(s),
      counts: s.workmap ? countsLine(s.workmap) : "",
      updated: formatZurich(lastUpdate(s)),
      href: `/map/${encodeURIComponent(s.id)}`,
    };
    const entry = byExpert.get(expert) ?? { latest: 0, rows: [] };
    entry.rows.push({ t, row });
    entry.latest = Math.max(entry.latest, t);
    byExpert.set(expert, entry);
  }
  return [...byExpert.entries()]
    .sort((a, b) => b[1].latest - a[1].latest || a[0].localeCompare(b[0]))
    .map(([expert, e]) => ({ expert, workflows: e.rows.sort((a, b) => b.t - a.t).map((r) => r.row) }));
}

function masteryRow(teach: SessionDigest, map: SessionDigest, learner: string): MasteryRow {
  const p = teach.teach!;
  return {
    workmapSessionId: map.id,
    task: map.workmap?.task || "Untitled capture",
    learner,
    date: formatZurich(p.finished_at ?? teach.ended_at ?? teach.started_at),
    mastered: stepLabels(p.mastered, map.workmap),
    practiceNext: stepLabels(p.practice, map.workmap),
    interventions: p.interventions,
    finished: !!p.finished_at,
  };
}

const teachTime = (s: SessionDigest) => time(s.teach?.finished_at ?? s.ended_at ?? s.started_at);

/** Teach sessions linked to a Work Map by Session.teach.workmap_session_id, newest first. */
function linkedTeach(sessions: SessionDigest[], mapId: string): SessionDigest[] {
  return sessions
    .filter((s) => s.kind === "teach" && s.teach?.workmap_session_id === mapId)
    .sort((a, b) => teachTime(b) - teachTime(a));
}

export function learnerSummaries(sessions: SessionDigest[], members: DashboardMember[], createdBy: CreatedBy): LearnerSummary[] {
  const confirmed = sessions.filter((s) => s.kind === "capture" && s.workmap?.confirmed_by_expert === true);
  return members
    .filter((m) => m.role === "learner")
    .map((m) => ({
      userId: m.userId,
      label: m.label,
      mastery: confirmed.flatMap((map) => {
        const latest = linkedTeach(sessions, map.id).find((t) => createdBy[t.id] === m.userId);
        return latest ? [masteryRow(latest, map, m.label)] : [];
      }),
    }));
}

export function buildDashboard(sessions: SessionDigest[], members: DashboardMember[], createdBy: CreatedBy): DashboardSummary {
  return { experts: expertWorkflows(sessions), learners: learnerSummaries(sessions, members, createdBy) };
}

/** Learners section of one Work Map: who practised it, when and the result. Latest session per person. */
export function workmapLearners(
  mapId: string,
  sessions: SessionDigest[],
  members: DashboardMember[],
  createdBy: CreatedBy,
): MasteryRow[] {
  const map = sessions.find((s) => s.id === mapId && s.kind === "capture");
  if (!map) return [];
  const labels = new Map(members.map((m) => [m.userId, m.label]));
  const seen = new Set<string>();
  const rows: MasteryRow[] = [];
  for (const t of linkedTeach(sessions, mapId)) {
    const who = createdBy[t.id] ?? null;
    const key = who ?? `session:${t.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push(masteryRow(t, map, who ? (labels.get(who) ?? who.slice(0, 8)) : "unknown"));
  }
  return rows;
}
