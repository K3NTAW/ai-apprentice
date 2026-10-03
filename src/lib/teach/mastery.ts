// Teach mastery tracking (docs/BUILD_SPEC.md Module 3). Pure: state in, new state out.
import type { WorkMapStep } from "@/lib/types";

export type StepMastery = { predicted?: boolean; stopped: boolean; fixed: boolean };
export type MasteryState = Record<number, StepMastery>;
export type MasterySummary = { mastered: string[]; practice_next: string[]; text: string };

const EMPTY: StepMastery = { stopped: false, fixed: false };

function update(state: MasteryState, n: number, patch: Partial<StepMastery>): MasteryState {
  return { ...state, [n]: { ...EMPTY, ...state[n], ...patch } };
}

export const recordPrediction = (state: MasteryState, n: number, correct: boolean): MasteryState =>
  update(state, n, { predicted: correct });

export const recordStop = (state: MasteryState, n: number): MasteryState => update(state, n, { stopped: true, fixed: false });

/** Marks every stopped, not yet fixed step as fixed (the learner saved cleanly after the stop). */
export function recordFixed(state: MasteryState): MasteryState {
  let out = state;
  for (const [n, m] of Object.entries(state)) if (m.stopped && !m.fixed) out = update(out, Number(n), { fixed: true });
  return out;
}

const STOP = new Set(["the", "and", "for", "with", "that", "this", "then", "into", "from", "every", "would", "will", "instead", "once", "are", "its", "not", "goes"]);

export function keywords(s: string): string[] {
  return [...new Set((s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []).filter((w) => !STOP.has(w)))];
}

/** Keyword match of the learner's answer against the step's decision: two shared keywords (or all, if fewer) count. */
export function scorePrediction(answer: string, step: Pick<WorkMapStep, "decision">): boolean {
  const want = keywords(step.decision);
  const got = new Set(keywords(answer));
  const hits = want.filter((w) => got.has(w)).length;
  return want.length > 0 && hits >= Math.min(2, want.length);
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

export function summary(state: MasteryState, steps: Pick<WorkMapStep, "n" | "title">[]): MasterySummary {
  const mastered: string[] = [];
  const practice_next: string[] = [];
  for (const step of steps) {
    const m = state[step.n];
    if (!m) continue;
    if (m.stopped || m.predicted === false) practice_next.push(step.title);
    else if (m.predicted) mastered.push(step.title);
  }
  const parts: string[] = [];
  if (mastered.length) parts.push(`You've got: ${list(mastered)}.`);
  if (practice_next.length) parts.push(`Practice next: ${list(practice_next)}.`);
  if (!parts.length) parts.push("Nothing practised yet. Open an invoice to start.");
  return { mastered, practice_next, text: parts.join(" ") };
}
