import type { DecisionResult, ScreenEvent } from "@/lib/types";
import type { AskKind } from "./prompts";

// Decides whether the interviewer asks about a screen event now, waits, or saves it for the debrief.
// Pure apart from the injected clock. Spec D7: ask less, later.

/**
 * Desktop companion activity (counts only). `fresh` is false when the last message is older than
 * COMPANION_STALE_MS or the socket is closed; a stale block is ignored and the gate falls back to
 * speech pause plus frame stillness (the browser-side silence_ms).
 */
export type CompanionActivity = { typing: boolean; idle_ms: number; fresh: boolean };

export type Activity = { typing: boolean; speaking: boolean; silence_ms: number; companion?: CompanionActivity };

export type AskGateInput = {
  event: ScreenEvent;
  eventClass: DecisionResult;
  screenExplains: DecisionResult;
  timing: DecisionResult;
  activity: Activity;
  agentSpeaking: boolean;
};

export type AskGateDecision = {
  action: "ask_now" | "wait" | "save_for_debrief";
  ask?: AskKind;
  why: string;
};

export type PendingItem = Omit<AskGateInput, "activity" | "agentSpeaking">;

export type AskGateOptions = {
  maxPer10Min?: number;
  minGapMs?: number;
  now?: () => number;
};

const WINDOW_MS = 10 * 60 * 1000;
export const MIN_SILENCE_MS = 1500;
export const COMPANION_STALE_MS = 1500;
const SCREEN_EXPLAINS_THRESHOLD = 0.7;
const GUARDRAIL_EVERY = 3;

/**
 * Folds fresh companion activity into the browser signals. Companion typing holds a question until
 * typing is false or idle_ms >= MIN_SILENCE_MS; effective silence is min(silence_ms, idle_ms).
 */
export function effectiveActivity(a: Activity): { typing: boolean; speaking: boolean; silence_ms: number } {
  const c = a.companion?.fresh ? a.companion : undefined;
  if (!c) return { typing: a.typing, speaking: a.speaking, silence_ms: a.silence_ms };
  return {
    typing: a.typing || (c.typing && c.idle_ms < MIN_SILENCE_MS),
    speaking: a.speaking,
    silence_ms: Math.min(a.silence_ms, c.idle_ms),
  };
}

export function createAskGate({ maxPer10Min = 5, minGapMs = 20000, now = Date.now }: AskGateOptions = {}) {
  const asked: { t: number; kind: AskKind }[] = [];
  let sinceGuardrail = 0;
  let pending: PendingItem[] = [];
  const debrief: PendingItem[] = [];

  function recent(t: number) {
    return asked.filter((a) => t - a.t < WINDOW_MS);
  }

  function consider(input: AskGateInput): AskGateDecision {
    const cls = String(input.eventClass.answer);
    const explains = typeof input.screenExplains.answer === "number" ? input.screenExplains.answer : 0;

    if (cls === "routine" || explains >= SCREEN_EXPLAINS_THRESHOLD) {
      const judgmentLike = cls === "judgment_call" || cls === "possible_guardrail";
      return judgmentLike
        ? { action: "save_for_debrief", why: "screen_explains_it" }
        : { action: "wait", why: "routine" };
    }

    const { typing, speaking, silence_ms } = effectiveActivity(input.activity);
    if (typing) return { action: "wait", why: "typing" };
    if (speaking) return { action: "wait", why: "speaking" };
    if (input.agentSpeaking) return { action: "wait", why: "agent_speaking" };
    if (silence_ms < MIN_SILENCE_MS) return { action: "wait", why: "no_pause" };

    const t = now();
    if (recent(t).length >= maxPer10Min) return { action: "save_for_debrief", why: "budget" };
    const last = asked[asked.length - 1];
    if (last && t - last.t < minGapMs) return { action: "save_for_debrief", why: "min_gap" };
    if (input.timing.answer === "save_for_debrief") return { action: "save_for_debrief", why: "timing" };

    if (cls === "possible_guardrail") return { action: "ask_now", ask: "guardrail", why: "possible_guardrail" };
    if (sinceGuardrail >= GUARDRAIL_EVERY) return { action: "ask_now", ask: "guardrail", why: "guardrail_guarantee" };
    return { action: "ask_now", ask: "reason", why: "judgment_call" };
  }

  function markAsked(kind: AskKind) {
    asked.push({ t: now(), kind });
    sinceGuardrail = kind === "guardrail" ? 0 : sinceGuardrail + 1;
  }

  function enqueue(item: PendingItem) {
    pending.push(item);
  }

  /** First pending event that may be asked now; events that turned into debrief material move to the debrief list. */
  function nextReady(activity: Activity & { agentSpeaking?: boolean }): { item: PendingItem; decision: AskGateDecision } | null {
    const keep: PendingItem[] = [];
    let found: { item: PendingItem; decision: AskGateDecision } | null = null;
    for (const item of pending) {
      if (found) {
        keep.push(item);
        continue;
      }
      const decision = consider({ ...item, activity, agentSpeaking: activity.agentSpeaking ?? false });
      if (decision.action === "ask_now") found = { item, decision };
      else if (decision.action === "save_for_debrief") debrief.push(item);
      else if (decision.why !== "routine") keep.push(item);
    }
    pending = keep;
    return found;
  }

  function drainDebrief(): PendingItem[] {
    return debrief.splice(0, debrief.length);
  }

  function stats() {
    return {
      asked: asked.length,
      askedLast10Min: recent(now()).length,
      guardrailAsked: asked.filter((a) => a.kind === "guardrail").length,
      reasonAsked: asked.filter((a) => a.kind === "reason").length,
      sinceGuardrail,
      pending: pending.length,
      debrief: debrief.length,
    };
  }

  return { consider, markAsked, enqueue, nextReady, drainDebrief, stats };
}

export type AskGate = ReturnType<typeof createAskGate>;
