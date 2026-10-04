import type { DecisionResult, ScreenEvent } from "@/lib/types";
import type { AskKind } from "./prompts";

// Decides whether the interviewer asks about a screen event now, waits, or saves it for the debrief.
// Pure apart from the injected clock.
// Cadence "active" (default, T-0240): ask at a real pause (speech silence >= 1.2 s, no typing for >= 2 s, screen
// stable >= 1 s) right after a meaningful action, at most one question per minGapMs (agent setting, default 60 s)
// and at most maxPer10Min (default 8) per 10 minutes; skip what the expert already explained in narration.
// Active also guarantees a guardrail question: with questions asked and none of them a guardrail one, the next is one;
// and a question blocked only by the minimum gap waits (the controller saves it after MAX_WAIT_MS) instead of going
// straight to the debrief (T-0252).
// Cadence "classic" is the old D7 'ask less, later' gate (1.5 s silence, 20 s gap, 5 per 10 min), kept for rollback.

/**
 * Desktop companion activity (counts only). `fresh` is false when the last message is older than
 * COMPANION_STALE_MS or the socket is closed; a stale block is ignored and the gate falls back to
 * speech pause plus frame stillness (the browser-side silence_ms).
 */
export type CompanionActivity = { typing: boolean; idle_ms: number; fresh: boolean };

export type Activity = {
  typing: boolean;
  speaking: boolean;
  /** Time since the last keystroke, speech end or frame change (classic pause signal). */
  silence_ms: number;
  /** Active cadence inputs; absent means silence_ms is used for each (logged by the caller, not silent). */
  speech_silence_ms?: number;
  typing_idle_ms?: number;
  screen_stable_ms?: number;
  companion?: CompanionActivity;
};

export type AskGateInput = {
  event: ScreenEvent;
  eventClass: DecisionResult;
  screenExplains: DecisionResult;
  timing: DecisionResult;
  activity: Activity;
  agentSpeaking: boolean;
  /** The expert already explained this event in unprompted narration (src/lib/capture/narration.ts). */
  explained?: boolean;
};

export type AskGateDecision = {
  action: "ask_now" | "wait" | "save_for_debrief";
  ask?: AskKind;
  why: string;
};

export type PendingItem = Omit<AskGateInput, "activity" | "agentSpeaking">;

export type AskCadence = "active" | "classic";

export type AskGateOptions = {
  /** Default "active"; "classic" is the rollback to the old cadence. */
  cadence?: AskCadence;
  /** Hard cap per 10 minutes. Default 8 (active) or 5 (classic). */
  maxPer10Min?: number;
  /** Minimum gap between two questions (agent setting 'At most one question every'). Default 60 s (active) or 20 s (classic). */
  minGapMs?: number;
  /** Agent setting 'Ask about guardrails first': possible guardrails jump the pending queue. */
  guardrailsFirst?: boolean;
  now?: () => number;
};

/** Priority of a pending event in nextReady (higher first, stable). possible_guardrail is 2 with guardrails first, else 1. */
export function questionPriority(eventClass: string, guardrailsFirst: boolean): number {
  return eventClass === "possible_guardrail" && guardrailsFirst ? 2 : 1;
}

const WINDOW_MS = 10 * 60 * 1000;
/** 'wait' decisions that settle an item: routine events and events the expert already explained. */
export const SETTLED_WAITS: ReadonlySet<string> = new Set(["routine", "explained_by_narration"]);
export const MIN_SILENCE_MS = 1500;
export const COMPANION_STALE_MS = 1500;
/** Active cadence pause: speech silence, no typing and a stable screen for at least these long. */
export const PAUSE_SPEECH_MS = 1200;
export const PAUSE_TYPING_MS = 2000;
export const PAUSE_SCREEN_MS = 1000;
export const ACTIVE_DEFAULTS = { minGapMs: 60_000, maxPer10Min: 8 } as const;
export const CLASSIC_DEFAULTS = { minGapMs: 20_000, maxPer10Min: 5 } as const;
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

/** Active cadence pause check; null when it is a real pause. Companion idle_ms counts as typing idle when fresh. */
export function activePause(a: Activity): "no_pause" | "typing" | "screen_moving" | null {
  const c = a.companion?.fresh ? a.companion : undefined;
  const speech = a.speech_silence_ms ?? a.silence_ms;
  const typingIdle = Math.min(a.typing_idle_ms ?? a.silence_ms, c ? c.idle_ms : Infinity);
  const stable = a.screen_stable_ms ?? a.silence_ms;
  if (typingIdle < PAUSE_TYPING_MS) return "typing";
  if (speech < PAUSE_SPEECH_MS) return "no_pause";
  if (stable < PAUSE_SCREEN_MS) return "screen_moving";
  return null;
}

export function createAskGate({ cadence = "active", maxPer10Min, minGapMs, guardrailsFirst = false, now = Date.now }: AskGateOptions = {}) {
  const defaults = cadence === "classic" ? CLASSIC_DEFAULTS : ACTIVE_DEFAULTS;
  const cap = maxPer10Min ?? defaults.maxPer10Min;
  const gap = minGapMs ?? defaults.minGapMs;
  const active = cadence !== "classic";
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

    // Already explained in narration: never asked, and not debrief material either.
    if (active && input.explained) return { action: "wait", why: "explained_by_narration" };

    const { typing, speaking, silence_ms } = effectiveActivity(input.activity);
    if (typing) return { action: "wait", why: "typing" };
    if (speaking) return { action: "wait", why: "speaking" };
    if (input.agentSpeaking) return { action: "wait", why: "agent_speaking" };
    if (active) {
      const held = activePause(input.activity);
      if (held) return { action: "wait", why: held };
    } else if (silence_ms < MIN_SILENCE_MS) return { action: "wait", why: "no_pause" };

    // Minimum gap first, then the 10-minute cap as the hard limit.
    const t = now();
    const last = asked[asked.length - 1];
    if (last && t - last.t < gap) return active ? { action: "wait", why: "min_gap" } : { action: "save_for_debrief", why: "min_gap" };
    if (recent(t).length >= cap) return { action: "save_for_debrief", why: "budget" };
    if (input.timing.answer === "save_for_debrief") return { action: "save_for_debrief", why: "timing" };

    if (cls === "possible_guardrail") return { action: "ask_now", ask: "guardrail", why: "possible_guardrail" };
    if (active && asked.length > 0 && !asked.some((a) => a.kind === "guardrail"))
      return { action: "ask_now", ask: "guardrail", why: "guardrail_guarantee" };
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
    const prio = (i: PendingItem) => questionPriority(String(i.eventClass.answer), guardrailsFirst);
    const ordered = pending.map((item, n) => ({ item, n })).sort((a, b) => prio(b.item) - prio(a.item) || a.n - b.n);
    for (const { item } of ordered) {
      if (found) {
        keep.push(item);
        continue;
      }
      const decision = consider({ ...item, activity, agentSpeaking: activity.agentSpeaking ?? false });
      if (decision.action === "ask_now") found = { item, decision };
      else if (decision.action === "save_for_debrief") debrief.push(item);
      else if (!SETTLED_WAITS.has(decision.why)) keep.push(item);
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
      cadence,
      minGapMs: gap,
      maxPer10Min: cap,
      pending: pending.length,
      debrief: debrief.length,
    };
  }

  return { consider, markAsked, enqueue, nextReady, drainDebrief, stats };
}

export type AskGate = ReturnType<typeof createAskGate>;
