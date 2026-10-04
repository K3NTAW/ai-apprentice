// Jev (typesafe.ai systemone) provider.
import { DECISION_QUESTIONS, type DecisionQuestionName } from "../types";
import { OPTION_DESCRIPTIONS, clamp01, serializeState, type RawAnswer } from "./prompts";

export const JEV_URL = "https://api.typesafe.ai/v1/systemone";
const TIMEOUT_MS = 5_000;
const RETRY_DELAY_MS = 500;
const SCORE_CRITERIA = ["not captured", "partly captured", "fully captured in the expert's own words"];

type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string }
  | { type: "score"; instructions: string; criteria: string[] };

type JevAnswer = {
  noul?: number;
  choice?: string;
  probabilities?: Record<string, number>;
  score?: number;
  confidence?: number;
};

export function jevQuestion(name: DecisionQuestionName): JevQuestion {
  const spec = DECISION_QUESTIONS[name];
  if (spec.kind === "choice") {
    const descs = OPTION_DESCRIPTIONS[name] ?? {};
    const criteria: Record<string, string> = {};
    for (const o of spec.options) criteria[o] = descs[o] ?? o;
    return { type: "choice", instructions: spec.prompt, criteria };
  }
  if (spec.kind === "probability") return { type: "noul", instructions: spec.prompt };
  return { type: "score", instructions: spec.prompt, criteria: SCORE_CRITERIA };
}

export function jevBody(questions: DecisionQuestionName[], state: unknown) {
  const qs: Record<string, JevQuestion> = {};
  for (const q of questions) qs[q] = jevQuestion(q);
  return { state: serializeState(state), model: process.env.JEV_MODEL ?? "jev-latest", questions: qs };
}

export function normaliseJevAnswer(name: DecisionQuestionName, a: JevAnswer | undefined): RawAnswer {
  if (!a) throw new Error(`jev: no answer for ${name}`);
  const spec = DECISION_QUESTIONS[name];
  if (spec.kind === "choice") {
    const options: readonly string[] = spec.options;
    if (typeof a.choice !== "string" || !options.includes(a.choice)) {
      throw new Error(`jev: bad choice for ${name}`);
    }
    const probs = a.probabilities ? Object.values(a.probabilities).filter((p) => typeof p === "number") : [];
    const confidence = a.confidence ?? (probs.length ? Math.max(...probs) : 0.5);
    return { answer: a.choice, confidence: clamp01(confidence) };
  }
  if (spec.kind === "probability") {
    if (typeof a.noul !== "number") throw new Error(`jev: bad noul for ${name}`);
    const p = clamp01(a.noul);
    return { answer: p, confidence: clamp01(Math.abs(p - 0.5) * 2) };
  }
  if (typeof a.score !== "number") throw new Error(`jev: bad score for ${name}`);
  const levels = SCORE_CRITERIA.length;
  const score = a.score > 1 ? a.score / (levels - 1) : a.score;
  return { answer: clamp01(score), confidence: clamp01(a.confidence ?? 0.5) };
}

async function postOnce(fetchImpl: typeof fetch, apiKey: string, body: string): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetchImpl(JEV_URL, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body,
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

export async function jevDecide(
  questions: DecisionQuestionName[],
  state: unknown,
  fetchImpl: typeof fetch,
): Promise<Partial<Record<DecisionQuestionName, RawAnswer>>> {
  const apiKey = process.env.JEV_API_KEY;
  if (!apiKey) throw new Error("jev: JEV_API_KEY not set");
  const body = JSON.stringify(jevBody(questions, state));
  let res = await postOnce(fetchImpl, apiKey, body);
  if (res.status === 429 || res.status === 529) {
    await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    res = await postOnce(fetchImpl, apiKey, body);
  }
  if (!res.ok) throw new Error(`jev: HTTP ${res.status}`);
  const json = (await res.json()) as { answers?: Record<string, JevAnswer> };
  const out: Partial<Record<DecisionQuestionName, RawAnswer>> = {};
  for (const q of questions) out[q] = normaliseJevAnswer(q, json.answers?.[q]);
  return out;
}
