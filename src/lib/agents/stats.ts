// Per-agent stats derived from the agent's sessions. Pure: no I/O.
//
// Formulas (amendment A8):
// - processes: capture sessions of the agent whose Work Map is confirmed by the expert.
// - guardrails: distinct guardrail rules across those confirmed Work Maps, deduped by the rule text
//   (trimmed, whitespace collapsed, case-insensitive).
// - learners: distinct non-null created_by of the agent's teach sessions.
// - last_trained: the latest ended_at, else started_at, of the agent's capture sessions; null without any.
// - shortcuts: distinct chords across those confirmed Work Maps (WorkMap.shortcuts), deduped by the chord
//   (spaces dropped, case-insensitive); null when there are none, which the cards show as "none yet".
//
// Processes (T-0212): when the agent has rows in public.processes, processes, guardrails and shortcuts come from
// its confirmed, non-archived processes instead of the confirmed capture sessions. Learners and last_trained stay
// session based. Without processes for the agent (or without the table: pass none) the session rule above applies.
import type { Session, WorkMap } from "@/lib/types";

/** A session plus its creator, which Session itself does not carry. */
export type AgentStatsSession = Pick<Session, "kind" | "started_at" | "ended_at" | "workmap" | "agent_id"> & {
  created_by?: string | null;
};

/** The process fields the stats read (a Process from the store fits). */
export type AgentStatsProcess = { agent_id: string; workmap: WorkMap; confirmed: boolean; archived_at: string | null };

export type AgentStats = {
  processes: number;
  shortcuts: number | null;
  guardrails: number;
  learners: number;
  last_trained: string | null;
};

const ruleKey = (rule: string) => rule.trim().replace(/\s+/g, " ").toLowerCase();
const chordKey = (chord: string) => chord.replace(/\s+/g, "").toLowerCase();

/** Stats for one agent from any list of sessions (and processes, when available); other agents are ignored. */
export function agentStats(
  agentId: string,
  sessions: readonly AgentStatsSession[],
  processes: readonly AgentStatsProcess[] = [],
): AgentStats {
  const mine = sessions.filter((s) => s.agent_id === agentId);
  const captures = mine.filter((s) => s.kind === "capture");
  const own = processes.filter((p) => p.agent_id === agentId);
  const maps: WorkMap[] =
    own.length > 0
      ? own.filter((p) => p.confirmed && !p.archived_at).map((p) => p.workmap)
      : captures.filter((s) => s.workmap?.confirmed_by_expert === true).map((s) => s.workmap!);

  const rules = new Set<string>();
  for (const m of maps) for (const step of m.steps) for (const g of step.guardrails) if (ruleKey(g.rule)) rules.add(ruleKey(g.rule));

  const chords = new Set<string>();
  for (const m of maps) for (const sc of m.shortcuts ?? []) if (chordKey(sc.chord)) chords.add(chordKey(sc.chord));

  const learners = new Set<string>();
  for (const s of mine) if (s.kind === "teach" && s.created_by) learners.add(s.created_by);

  let last: string | null = null;
  for (const s of captures) {
    const t = s.ended_at ?? s.started_at;
    if (last === null || Date.parse(t) > Date.parse(last)) last = t;
  }

  return { processes: maps.length, shortcuts: chords.size || null, guardrails: rules.size, learners: learners.size, last_trained: last };
}
