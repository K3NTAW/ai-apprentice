// Anthropic Messages API fallback with structured JSON output.
import { DECISION_QUESTIONS, type DecisionQuestionName } from "../types";
import { OPTION_DESCRIPTIONS, SYSTEM_PROMPT, clamp01, serializeState, type RawAnswer } from "./prompts";

export const LLM_URL = "https://api.anthropic.com/v1/messages";
const TIMEOUT_MS = 8_000;

export function llmSchema(questions: DecisionQuestionName[]) {
  const properties: Record<string, unknown> = {};
  for (const q of questions) {
    const spec = DECISION_QUESTIONS[q];
    const answer = spec.kind === "choice" ? { type: "string", enum: [...spec.options] } : { type: "number" };
    properties[q] = {
      type: "object",
      properties: { answer, confidence: { type: "number" } },
      required: ["answer", "confidence"],
      additionalProperties: false,
    };
  }
  return { type: "object", properties, required: [...questions], additionalProperties: false };
}

function userPrompt(questions: DecisionQuestionName[], state: unknown): string {
  const lines = questions.map((q) => {
    const spec = DECISION_QUESTIONS[q];
    if (spec.kind === "choice") {
      const descs = OPTION_DESCRIPTIONS[q] ?? {};
      const opts = spec.options.map((o) => `${o}: ${descs[o] ?? o}`).join("; ");
      return `- ${q} (choose one): ${spec.prompt} Options: ${opts}`;
    }
    if (spec.kind === "probability") return `- ${q} (probability 0..1): ${spec.prompt}`;
    return `- ${q} (score 0..1, 0 not captured, 0.5 partly, 1 fully in the expert's own words): ${spec.prompt}`;
  });
  return `Questions:\n${lines.join("\n")}\n\nState:\n${serializeState(state)}`;
}

export function llmBody(questions: DecisionQuestionName[], state: unknown) {
  return {
    model: process.env.DECIDE_MODEL ?? "claude-haiku-4-5-20251001",
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt(questions, state) }],
    output_config: { format: { type: "json_schema", schema: llmSchema(questions) } },
  };
}

function normalise(name: DecisionQuestionName, raw: unknown): RawAnswer {
  const r = raw as { answer?: unknown; confidence?: unknown } | undefined;
  if (!r || typeof r !== "object") throw new Error(`llm: no answer for ${name}`);
  const confidence = clamp01(typeof r.confidence === "number" ? r.confidence : 0.5);
  const spec = DECISION_QUESTIONS[name];
  if (spec.kind === "choice") {
    const given = String(r.answer ?? "").trim().toLowerCase();
    const match = spec.options.find((o) => o.toLowerCase() === given);
    if (!match) throw new Error(`llm: bad choice for ${name}`);
    return { answer: match, confidence };
  }
  if (typeof r.answer !== "number") throw new Error(`llm: bad number for ${name}`);
  return { answer: clamp01(r.answer), confidence };
}

export async function llmDecide(
  questions: DecisionQuestionName[],
  state: unknown,
  fetchImpl: typeof fetch,
): Promise<Partial<Record<DecisionQuestionName, RawAnswer>>> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error("llm: ANTHROPIC_API_KEY not set");
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  let json: { stop_reason?: string; content?: { type: string; text?: string }[] };
  try {
    const res = await fetchImpl(LLM_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(llmBody(questions, state)),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`llm: HTTP ${res.status}`);
    json = await res.json();
  } finally {
    clearTimeout(timer);
  }
  if (json.stop_reason === "refusal") throw new Error("llm: refusal");
  const text = json.content?.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("llm: empty response");
  const parsed = JSON.parse(text) as Record<string, unknown>;
  const out: Partial<Record<DecisionQuestionName, RawAnswer>> = {};
  for (const q of questions) out[q] = normalise(q, parsed[q]);
  return out;
}
