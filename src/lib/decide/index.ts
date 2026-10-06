// Decision layer (docs/BUILD_SPEC.md D5, D6). Server-side only.
// Chain: Jev, then LLM, then heuristic. Errors fall through; decide never throws.
import type { DecisionQuestionName, DecisionResult } from "../types";
import { heuristicDecide } from "./heuristic";
import { jevDecide } from "./jev";
import { llmDecide } from "./llm";
import type { RawAnswer } from "./prompts";
import type { ModelUsage } from "../perception/vision";

export type Provider = DecisionResult["provider"];
/** onUsage: called once when the LLM answered (never on the jev or heuristic paths); a throw in it is swallowed. */
export type DecideOptions = { fetchImpl?: typeof fetch; provider?: Provider; onUsage?: (u: ModelUsage) => void };
type Answers = Partial<Record<DecisionQuestionName, RawAnswer>>;

const PROVIDERS: readonly Provider[] = ["jev", "llm", "heuristic"];

function chain(forced?: Provider): Provider[] {
  const env = process.env.DECIDE_PROVIDER as Provider | undefined;
  const pick = forced ?? (env && PROVIDERS.includes(env) ? env : undefined);
  if (pick) return pick === "heuristic" ? ["heuristic"] : [pick, "heuristic"];
  const out: Provider[] = [];
  if (process.env.JEV_API_KEY) out.push("jev");
  if (process.env.ANTHROPIC_API_KEY) out.push("llm");
  out.push("heuristic");
  return out;
}

async function run(p: Provider, qs: DecisionQuestionName[], state: unknown, f: typeof fetch, onUsage?: DecideOptions["onUsage"]): Promise<Answers> {
  if (p === "jev") return jevDecide(qs, state, f);
  if (p === "llm") {
    const { answers, usage } = await llmDecide(qs, state, f);
    if (usage && onUsage) {
      try {
        onUsage(usage);
      } catch {
        // Metering never changes the answer.
      }
    }
    return answers;
  }
  return heuristicDecide(qs, state);
}

export async function decideMany(
  questions: DecisionQuestionName[],
  state: unknown,
  opts: DecideOptions = {},
): Promise<Record<DecisionQuestionName, DecisionResult>> {
  const qs = [...new Set(questions)];
  const fetchImpl = opts.fetchImpl ?? fetch;
  for (const provider of chain(opts.provider)) {
    const start = Date.now();
    let answers: Answers;
    try {
      answers = await run(provider, qs, state, fetchImpl, opts.onUsage);
    } catch (err) {
      console.warn(`decide: ${provider} failed, falling through`, err instanceof Error ? err.message : err);
      continue;
    }
    const latency_ms = Date.now() - start;
    const out = {} as Record<DecisionQuestionName, DecisionResult>;
    for (const q of qs) {
      const a = answers[q]!;
      out[q] = { question: q, answer: a.answer, confidence: a.confidence, provider, latency_ms };
    }
    return out;
  }
  // Unreachable: the heuristic provider is always last and never throws.
  throw new Error("decide: no provider answered");
}

export async function decide(
  question: DecisionQuestionName,
  state: unknown,
  opts?: DecideOptions,
): Promise<DecisionResult> {
  const results = await decideMany([question], state, opts);
  return results[question];
}
