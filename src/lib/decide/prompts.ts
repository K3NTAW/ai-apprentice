// Prompt text for the decision layer (docs/BUILD_SPEC.md D5, D6, section 8).
import type { DecisionQuestionName } from "../types";

/** One-line descriptions per option of each choice question. Used as Jev criteria and LLM hints. */
export const OPTION_DESCRIPTIONS: Partial<Record<DecisionQuestionName, Record<string, string>>> = {
  event_class: {
    routine: "A standard step the screen alone explains, e.g. switching apps, opening or navigating; no reason needed.",
    judgment_call:
      "The expert chose between options, overrode a default value, routed something to a person, or held or deleted something; the reason is worth asking.",
    possible_guardrail: "The expert stopped, flagged, escalated or asked someone; a limit, an exception or a stop-and-ask rule may be behind it.",
  },
  ask_timing: {
    ask_now: "The expert is idle and the moment is fresh; a short question will not interrupt.",
    wait: "The expert is typing or mid-action; ask in a few seconds.",
    save_for_debrief: "Too many questions recently or low value now; keep it for the debrief.",
  },
};

export const SYSTEM_PROMPT =
  "You are a fast decision function for an AI apprentice watching an expert do real work in any app. " +
  "Judgment calls are choices between options, overrides of a default, routing to a person, holding or deleting something. " +
  "Guardrails are limits, exceptions and stop-and-ask rules the expert stated. " +
  "Answer only from the given state; do not assume facts that are not in it. " +
  "Reply with JSON matching the schema: one object per question with an answer and a confidence between 0 and 1.";

export const STATE_MAX_CHARS = 100_000;

export function serializeState(state: unknown): string {
  const s = typeof state === "string" ? state : (JSON.stringify(state) ?? "");
  return s.slice(0, STATE_MAX_CHARS);
}

export function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Answer and confidence before provider and latency are attached. */
export type RawAnswer = { answer: string | number; confidence: number };
