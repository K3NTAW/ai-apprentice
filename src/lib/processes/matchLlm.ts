// Server only: the process match decision through the Anthropic Messages API (same model and transport as
// lib/decide/llm). The choice is one of the candidate ids or 'new'. Throws on any failure; matchProcess then
// falls back to heuristicMatch.
import { LLM_URL } from "@/lib/decide/llm";
import type { MatchAnswer, MatchDecide, MatchState } from "./match";

const TIMEOUT_MS = 8_000;

const SYSTEM =
  "You decide whether a newly trained work process is the same process as one the agent already knows. " +
  "Same process means the same task on the same apps and objects, even if steps were added or skipped. " +
  "Answer with the matching process id, or 'new' when none is the same process, and your confidence 0..1.";

export function matchLlmBody(state: MatchState) {
  const ids = [...state.processes.map((p) => p.id), "new"];
  return {
    model: process.env.DECIDE_MODEL ?? "claude-haiku-4-5-20251001",
    max_tokens: 200,
    system: SYSTEM,
    messages: [{ role: "user", content: `State:\n${JSON.stringify(state)}` }],
    output_config: {
      format: {
        type: "json_schema",
        schema: {
          type: "object",
          properties: { answer: { type: "string", enum: ids }, confidence: { type: "number" } },
          required: ["answer", "confidence"],
          additionalProperties: false,
        },
      },
    },
  };
}

export function llmMatch(fetchImpl: typeof fetch = fetch): MatchDecide | undefined {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return undefined;
  return async (state: MatchState): Promise<MatchAnswer> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetchImpl(LLM_URL, {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify(matchLlmBody(state)),
        signal: ctrl.signal,
      });
      if (!res.ok) throw new Error(`match: HTTP ${res.status}`);
      const json = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = json.content?.find((c) => c.type === "text")?.text;
      if (!text) throw new Error("match: empty response");
      const parsed = JSON.parse(text) as { answer?: unknown; confidence?: unknown };
      if (typeof parsed.answer !== "string" || typeof parsed.confidence !== "number") throw new Error("match: bad answer");
      return { answer: parsed.answer, confidence: parsed.confidence };
    } finally {
      clearTimeout(timer);
    }
  };
}
