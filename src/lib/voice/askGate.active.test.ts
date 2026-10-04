// T-0240: active ask cadence. Real pause after a meaningful action, never while typing or talking,
// skip what narration explained, minimum gap (agent setting, default 60 s), hard cap 8 per 10 minutes.
import { describe, expect, it } from "vitest";
import type { DecisionResult, ScreenEvent } from "@/lib/types";
import { ACTIVE_DEFAULTS, activePause, createAskGate, type Activity, type AskGateInput } from "./askGate";

const event: ScreenEvent = { id: "e1", t: 10, source: "os", type: "field_changed", entity: { kind: "invoice", id: "4471" }, field: "cost_center", from: "4711", to: "0400" };
const dr = (question: DecisionResult["question"], answer: string | number): DecisionResult => ({ question, answer, confidence: 0.9, provider: "heuristic", latency_ms: 1 });
const pause: Activity = { typing: false, speaking: false, silence_ms: 5000, speech_silence_ms: 5000, typing_idle_ms: 5000, screen_stable_ms: 5000 };

function input(over: Omit<Partial<AskGateInput>, "activity"> & { cls?: string; activity?: Partial<Activity> } = {}): AskGateInput {
  const { cls = "judgment_call", activity, ...rest } = over;
  return {
    event,
    eventClass: dr("event_class", cls),
    screenExplains: dr("screen_explains_it", 0.1),
    timing: dr("ask_timing", "ask_now"),
    activity: { ...pause, ...activity },
    agentSpeaking: false,
    ...rest,
  };
}

function clock() {
  let t = 1_000_000;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("active ask gate", () => {
  it("defaults: active cadence, 60 s minimum gap, 8 per 10 minutes", () => {
    const s = createAskGate({ now: () => 0 }).stats();
    expect(s).toMatchObject({ cadence: "active", minGapMs: 60_000, maxPer10Min: 8 });
    expect(ACTIVE_DEFAULTS).toEqual({ minGapMs: 60_000, maxPer10Min: 8 });
  });

  it("asks at a real pause after a meaningful action, with a short on-screen question kind", () => {
    const g = createAskGate({ now: () => 0 });
    expect(g.consider(input())).toMatchObject({ action: "ask_now", ask: "reason" });
    expect(g.consider(input({ cls: "possible_guardrail" }))).toMatchObject({ action: "ask_now", ask: "guardrail" });
    // Not meaningful: routine actions are never asked.
    expect(g.consider(input({ cls: "routine" }))).toMatchObject({ action: "wait", why: "routine" });
  });

  it("pause detection: speech silence >= 1.2 s, no typing for >= 2 s, screen stable", () => {
    const g = createAskGate({ now: () => 0 });
    expect(g.consider(input({ activity: { speech_silence_ms: 1100 } }))).toMatchObject({ action: "wait", why: "no_pause" });
    expect(g.consider(input({ activity: { speech_silence_ms: 1200 } })).action).toBe("ask_now");
  });

  it("typing hold: never while typing, and not until 2 s after the last keystroke (companion idle counts)", () => {
    const g = createAskGate({ now: () => 0 });
    expect(g.consider(input({ activity: { typing: true } }))).toMatchObject({ action: "wait", why: "typing" });
    expect(g.consider(input({ activity: { typing_idle_ms: 1900 } }))).toMatchObject({ action: "wait", why: "typing" });
    expect(g.consider(input({ activity: { companion: { typing: false, idle_ms: 1500, fresh: true } } }))).toMatchObject({ why: "typing" });
    expect(g.consider(input({ activity: { companion: { typing: false, idle_ms: 1500, fresh: false } } })).action).toBe("ask_now");
    expect(activePause({ ...pause, typing_idle_ms: 2000 })).toBeNull();
  });

  it("never while the expert talks or the agent speaks; waits while the screen still moves", () => {
    const g = createAskGate({ now: () => 0 });
    expect(g.consider(input({ activity: { speaking: true } }))).toMatchObject({ action: "wait", why: "speaking" });
    expect(g.consider(input({ agentSpeaking: true }))).toMatchObject({ action: "wait", why: "agent_speaking" });
    expect(g.consider(input({ activity: { screen_stable_ms: 400 } }))).toMatchObject({ action: "wait", why: "screen_moving" });
  });

  it("skips what narration already explained (settled, not debrief material)", () => {
    const g = createAskGate({ now: () => 0 });
    expect(g.consider(input({ explained: true }))).toMatchObject({ action: "wait", why: "explained_by_narration" });
    g.enqueue({ event, eventClass: dr("event_class", "judgment_call"), screenExplains: dr("screen_explains_it", 0.1), timing: dr("ask_timing", "ask_now"), explained: true });
    expect(g.nextReady(pause)).toBeNull();
    expect(g.stats()).toMatchObject({ pending: 0, debrief: 0 });
  });

  it("respects the per-agent minimum gap", () => {
    const c = clock();
    const g = createAskGate({ now: c.now, minGapMs: 120_000 });
    expect(g.consider(input()).action).toBe("ask_now");
    g.markAsked("reason");
    c.advance(90_000);
    expect(g.consider(input())).toMatchObject({ action: "save_for_debrief", why: "min_gap" });
    c.advance(30_000);
    expect(g.consider(input()).action).toBe("ask_now");
  });

  it("default gap 60 s, then the 10-minute cap (8) as the hard limit", () => {
    const c = clock();
    const g = createAskGate({ now: c.now });
    g.markAsked("reason");
    c.advance(59_000);
    expect(g.consider(input())).toMatchObject({ why: "min_gap" });
    c.advance(1_000);
    for (let i = 1; i < 8; i++) {
      expect(g.consider(input()).action).toBe("ask_now");
      g.markAsked("reason");
      c.advance(60_000);
    }
    // 8 asked within the last 10 minutes (at 0..7 min, now 8 min): capped.
    expect(g.consider(input())).toMatchObject({ action: "save_for_debrief", why: "budget" });
    c.advance(2 * 60_000 + 1);
    expect(g.consider(input()).action).toBe("ask_now");
  });

  it("classic cadence (rollback) ignores the new inputs and keeps 20 s / 5 per 10 minutes", () => {
    const g = createAskGate({ cadence: "classic", now: () => 0 });
    expect(g.stats()).toMatchObject({ cadence: "classic", minGapMs: 20_000, maxPer10Min: 5 });
    expect(g.consider(input({ explained: true, activity: { screen_stable_ms: 0 } })).action).toBe("ask_now");
  });
});
