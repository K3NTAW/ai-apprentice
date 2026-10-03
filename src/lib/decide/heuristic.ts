// Deterministic last resort. Never throws; works on partial or unknown state shapes.
import type { DecisionQuestionName } from "../types";
import type { RawAnswer } from "./prompts";

const CONFIDENCE = 0.4;
const EQUIPMENT = /equip|machine|hardware|device|server|laptop|computer|forklift|tool|anlage|ger[äa]t|asset/i;

type HState = {
  event?: { type?: string; field?: string; to?: string };
  silence_ms?: number;
  typing?: boolean;
  questions_asked_last_10min?: number;
  step?: { reason?: { quote?: string } | null; guardrails?: unknown[] };
  pending?: {
    amount_eur?: number;
    description?: string;
    category?: string;
    cost_center?: string;
    asset_number?: string;
  };
};

function asState(state: unknown): HState {
  if (typeof state === "string") {
    try {
      return asState(JSON.parse(state));
    } catch {
      return {};
    }
  }
  return state && typeof state === "object" ? (state as HState) : {};
}

function eventClass(s: HState): string {
  const e = s.event;
  if (!e) return "routine";
  if (e.type === "field_changed" && e.field === "cost_center") return "judgment_call";
  if (e.type === "status_changed") return "possible_guardrail";
  if (e.type === "button_clicked" && [e.to, e.field].some((v) => /^(hold|send for 2nd approval)$/i.test((v ?? "").trim()))) {
    return "possible_guardrail";
  }
  return "routine";
}

function askTiming(s: HState): string {
  if (s.typing || (typeof s.silence_ms === "number" && s.silence_ms < 1500)) return "wait";
  if ((s.questions_asked_last_10min ?? 0) >= 5) return "save_for_debrief";
  return "ask_now";
}

function violatesGuardrail(s: HState): number {
  const p = s.pending;
  if (!p) return 0.1;
  const equipment = EQUIPMENT.test(`${p.description ?? ""} ${p.category ?? ""}`);
  const miscoded = p.cost_center !== "0400" || !p.asset_number;
  return (p.amount_eur ?? 0) > 5000 && equipment && miscoded ? 0.9 : 0.1;
}

export function heuristicAnswer(question: DecisionQuestionName, state: unknown): RawAnswer {
  const s = asState(state);
  const answer = (() => {
    switch (question) {
      case "event_class":
        return eventClass(s);
      case "screen_explains_it":
        return 0.3;
      case "ask_timing":
        return askTiming(s);
      case "step_reason_captured":
        return s.step?.reason?.quote ? 1 : 0;
      case "step_guardrail_captured":
        return (s.step?.guardrails?.length ?? 0) > 0 ? 1 : 0;
      case "violates_guardrail":
        return violatesGuardrail(s);
    }
  })();
  return { answer, confidence: CONFIDENCE };
}

export function heuristicDecide(
  questions: DecisionQuestionName[],
  state: unknown,
): Partial<Record<DecisionQuestionName, RawAnswer>> {
  const out: Partial<Record<DecisionQuestionName, RawAnswer>> = {};
  for (const q of questions) out[q] = heuristicAnswer(q, state);
  return out;
}
