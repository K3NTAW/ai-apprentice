// Processes slice (c): which existing process a newly confirmed Work Map belongs to. Pure, no I/O.
// The decision is a choice among the agent's process ids or 'new', with a confidence. The decide function is
// injected (the route passes the LLM one when a key is set, tests a mock); heuristicMatch is the fallback.
// An answer that is not one of the candidates, or one below MATCH_THRESHOLD, becomes 'new'.
import type { Process } from "@/lib/store/types";
import type { WorkMap } from "@/lib/types";

export const MATCH_THRESHOLD = 0.5;

export type MatchCandidate = { id: string; title: string; steps: string[] };
export type MatchState = { workmap: { task: string; steps: string[] }; processes: MatchCandidate[] };
export type MatchAnswer = { answer: string; confidence: number };
export type MatchDecide = (state: MatchState) => Promise<MatchAnswer>;
export type MatchResult = { choice: string | "new"; confidence: number; title: string | null };

type Candidate = Pick<Process, "id" | "title" | "workmap" | "archived_at">;

const stepSummary = (s: WorkMap["steps"][number]) =>
  [s.title, s.screen_moment.app, s.screen_moment.entity].filter((x) => x && x.trim()).join(" · ");

export function matchState(workmap: WorkMap, processes: readonly Candidate[]): MatchState {
  return {
    workmap: { task: workmap.task, steps: workmap.steps.map(stepSummary) },
    processes: processes.filter((p) => !p.archived_at).map((p) => ({ id: p.id, title: p.title, steps: p.workmap.steps.map(stepSummary) })),
  };
}

const words = (text: string) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2));

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let both = 0;
  for (const w of a) if (b.has(w)) both++;
  return both / (a.size + b.size - both);
}

/** Word overlap of title and step summaries (title counts double). Deterministic, never throws. */
export async function heuristicMatch(state: MatchState): Promise<MatchAnswer> {
  const task = words(state.workmap.task);
  const steps = words(state.workmap.steps.join(" "));
  let best: MatchAnswer = { answer: "new", confidence: 0 };
  for (const p of state.processes) {
    const score = (2 * jaccard(task, words(p.title)) + jaccard(steps, words(p.steps.join(" ")))) / 3;
    if (score > best.confidence) best = { answer: p.id, confidence: Math.min(1, score * 1.5) };
  }
  return best;
}

/** The best existing process for the Work Map, or 'new'. A failing decide falls back to the heuristic. */
export async function matchProcess(
  workmap: WorkMap,
  processes: readonly Candidate[],
  decideFn: MatchDecide = heuristicMatch,
  threshold = MATCH_THRESHOLD,
): Promise<MatchResult> {
  const state = matchState(workmap, processes);
  if (state.processes.length === 0) return { choice: "new", confidence: 1, title: null };
  const answer = await decideFn(state).catch(() => heuristicMatch(state));
  const hit = state.processes.find((p) => p.id === answer.answer);
  const confidence = Math.max(0, Math.min(1, answer.confidence));
  if (!hit || confidence < threshold) return { choice: "new", confidence: hit ? 1 - confidence : confidence, title: null };
  return { choice: hit.id, confidence, title: hit.title };
}
