// Deterministic last resort. Never throws; works on partial or unknown state shapes. App-agnostic.
import type { DecisionQuestionName } from "../types";
import type { RawAnswer } from "./prompts";
import { shortcutVerdict } from "./shortcut";

const CONFIDENCE = 0.4;
/** Buttons and statuses that stop, park or escalate something. */
const STOPPING = /^(hold|on[ _]hold|flag(ged)?|escalate|reject(ed)?|block(ed)?|stop|pause|report|second[ _]approval|send for 2nd approval)$/i;

type HEvent = {
  type?: string;
  t?: number;
  field?: string;
  from?: string;
  to?: string;
  chord?: string;
  app?: string;
  entity?: { kind?: string; id?: string };
};
type HState = {
  event?: HEvent;
  /** Recent events before this one, oldest first. */
  previous_events?: HEvent[];
  recent_events?: HEvent[];
  /** shortcut_used only: the vision events linked as its effect. */
  effects?: HEvent[];
  silence_ms?: number;
  typing?: boolean;
  questions_asked_last_10min?: number;
  step?: { reason?: { quote?: string } | null; guardrails?: unknown[] };
  /** Pending action in Teach: a numeric value and the captured limit, or a delete/send under a stop-and-ask rule. */
  pending?: { type?: string; value?: number; limit?: number };
  guardrails?: { kind?: string }[];
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

const trim = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/** item_sent is routine only when it goes to the same recipient as the last item sent before it. */
function newRecipient(e: HEvent, previous: HEvent[] | undefined): boolean {
  const prior = (Array.isArray(previous) ? previous : []).filter((p) => p?.type === "item_sent" && trim(p.to));
  const last = prior[prior.length - 1];
  return !last || trim(last.to).toLowerCase() !== trim(e.to).toLowerCase();
}

function eventClass(s: HState): string {
  const e = s.event;
  if (!e) return "routine";
  switch (e.type) {
    case "item_deleted":
      return "judgment_call";
    case "shortcut_used": {
      const history = [...(Array.isArray(s.previous_events) ? s.previous_events : []), ...(Array.isArray(s.recent_events) ? s.recent_events : [])];
      return shortcutVerdict(e, Array.isArray(s.effects) ? s.effects : [], history).candidate ? "judgment_call" : "routine";
    }
    case "item_sent":
      return newRecipient(e, s.previous_events) ? "judgment_call" : "routine";
    case "status_changed":
      return "possible_guardrail";
    case "button_clicked":
      return [e.to, e.field, e.entity?.id].some((v) => STOPPING.test(trim(v))) ? "possible_guardrail" : "routine";
    case "field_changed":
      // Overriding a value that was already there; a first entry is routine.
      return trim(e.from) && trim(e.from) !== trim(e.to) ? "judgment_call" : "routine";
    default:
      // record_opened, navigated, app_switched, text_entered, item_created
      return "routine";
  }
}

function askTiming(s: HState): string {
  if (s.typing || (typeof s.silence_ms === "number" && s.silence_ms < 1500)) return "wait";
  if ((s.questions_asked_last_10min ?? 0) >= 5) return "save_for_debrief";
  return "ask_now";
}

function violatesGuardrail(s: HState): number {
  const p = s.pending;
  if (!p || typeof p !== "object") return 0.1;
  if (typeof p.value === "number" && typeof p.limit === "number" && p.value > p.limit) return 0.9;
  const stopAndAsk = Array.isArray(s.guardrails) && s.guardrails.some((g) => g?.kind === "stop_and_ask");
  if (stopAndAsk && (p.type === "item_deleted" || p.type === "item_sent")) return 0.6;
  return 0.1;
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
