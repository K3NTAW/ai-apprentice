// Teach mastery tracking. Pure: state in, new state out. Produces Session.teach (TeachProgressSchema in src/lib/types.ts).
import { TEACH_LIST_MAX, TeachProgressSchema, type TeachProgress, type WorkMapStep } from "@/lib/types";

export type StepMastery = { predicted?: boolean; stopped: boolean };
export type MasteryState = Record<number, StepMastery>;
export type MasterySummary = { mastered: string[]; practice: string[]; text: string };

const EMPTY: StepMastery = { stopped: false };

function update(state: MasteryState, n: number, patch: Partial<StepMastery>): MasteryState {
  return { ...state, [n]: { ...EMPTY, ...state[n], ...patch } };
}

export const recordPrediction = (state: MasteryState, n: number, correct: boolean): MasteryState =>
  update(state, n, { predicted: correct });

/** The tutor had to stop the learner on this step. */
export const recordStop = (state: MasteryState, n: number): MasteryState => update(state, n, { stopped: true });

const STOP = new Set(["the", "and", "for", "with", "that", "this", "then", "into", "from", "every", "would", "will", "instead", "once", "are", "its", "not", "goes", "gets"]);

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

/** Step ids (String(n)): mastered = predicted right and never stopped; practice = stopped or predicted wrong. */
export function masteryLists(state: MasteryState, steps: Pick<WorkMapStep, "n">[]): { mastered: string[]; practice: string[] } {
  const mastered: string[] = [];
  const practice: string[] = [];
  for (const step of steps) {
    const m = state[step.n];
    if (!m) continue;
    if (m.stopped || m.predicted === false) practice.push(String(step.n));
    else if (m.predicted) mastered.push(String(step.n));
  }
  return { mastered, practice };
}

function list(items: string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** What the page shows and the tutor speaks at the end: 'Mastered: ... Practice next: ...'. */
export function summary(state: MasteryState, steps: Pick<WorkMapStep, "n" | "title">[]): MasterySummary {
  const ids = masteryLists(state, steps);
  const title = (id: string) => steps.find((s) => String(s.n) === id)?.title ?? id;
  const mastered = ids.mastered.map(title);
  const practice = ids.practice.map(title);
  const parts: string[] = [];
  parts.push(mastered.length ? `Mastered: ${list(mastered)}.` : "Mastered: nothing yet.");
  parts.push(practice.length ? `Practice next: ${list(practice)}.` : "Practice next: nothing, well done.");
  return { mastered, practice, text: parts.join(" ") };
}

/**
 * Session.teach for the finished teach session. finished_at comes from the injected clock when the learner ends.
 * mastered is the union with the stored list; practice is this session's; both capped at TEACH_LIST_MAX.
 * interventions adds this session's count to the stored one (monotonic).
 */
export function buildTeachProgress(input: {
  workmapSessionId: string;
  state: MasteryState;
  steps: Pick<WorkMapStep, "n">[];
  interventions: number;
  previous?: TeachProgress;
  now?: () => number;
}): TeachProgress {
  const { mastered, practice } = masteryLists(input.state, input.steps);
  const prev = input.previous?.workmap_session_id === input.workmapSessionId ? input.previous : undefined;
  return TeachProgressSchema.parse({
    workmap_session_id: input.workmapSessionId,
    mastered: [...new Set([...(prev?.mastered ?? []), ...mastered])].slice(0, TEACH_LIST_MAX),
    practice: practice.slice(0, TEACH_LIST_MAX),
    interventions: (prev?.interventions ?? 0) + Math.max(0, Math.floor(input.interventions)),
    finished_at: new Date((input.now ?? Date.now)()).toISOString(),
  });
}
