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
import type { Session } from "@/lib/types";

/** A session plus its creator, which Session itself does not carry. */
export type AgentStatsSession = Pick<Session, "kind" | "started_at" | "ended_at" | "workmap" | "agent_id"> & {
  created_by?: string | null;
};

export type AgentStats = {
  processes: number;
  shortcuts: number | null;
  guardrails: number;
  learners: number;
  last_trained: string | null;
};

const ruleKey = (rule: string) => rule.trim().replace(/\s+/g, " ").toLowerCase();
const chordKey = (chord: string) => chord.replace(/\s+/g, "").toLowerCase();

/** Stats for one agent from any list of sessions; sessions of other agents are ignored. */
export function agentStats(agentId: string, sessions: readonly AgentStatsSession[]): AgentStats {
  const mine = sessions.filter((s) => s.agent_id === agentId);
  const captures = mine.filter((s) => s.kind === "capture");
  const confirmed = captures.filter((s) => s.workmap?.confirmed_by_expert === true);

  const rules = new Set<string>();
  for (const s of confirmed)
    for (const step of s.workmap!.steps) for (const g of step.guardrails) if (ruleKey(g.rule)) rules.add(ruleKey(g.rule));

  const chords = new Set<string>();
  for (const s of confirmed) for (const sc of s.workmap!.shortcuts ?? []) if (chordKey(sc.chord)) chords.add(chordKey(sc.chord));

  const learners = new Set<string>();
  for (const s of mine) if (s.kind === "teach" && s.created_by) learners.add(s.created_by);

  let last: string | null = null;
  for (const s of captures) {
    const t = s.ended_at ?? s.started_at;
    if (last === null || Date.parse(t) > Date.parse(last)) last = t;
  }

  return { processes: confirmed.length, shortcuts: chords.size || null, guardrails: rules.size, learners: learners.size, last_trained: last };
}
