// Active cadence in the capture loop (T-0252 P0-2): guardrail guarantee, gap-blocked questions wait,
// and Agent Settings reach the gate, the controller and the voice overrides.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivityTracker } from "@/lib/perception/activity";
import { createEventBus } from "@/lib/perception/eventBus";
import { createAskGate, type AskGateOptions } from "@/lib/voice/askGate";
import type { DecisionQuestionName, DecisionResult } from "@/lib/types";
import { resolveSettings } from "@/lib/agents/settings";
import { captureSettings } from "@/components/capture/sessionControls";
import { createCaptureController, MAX_WAIT_MS, type CaptureApi, type CaptureControllerOptions, type CaptureVoice } from "./controller";

const dr = (question: DecisionQuestionName, answer: string | number): DecisionResult => ({
  question,
  answer,
  confidence: 0.9,
  provider: "heuristic",
  latency_ms: 1,
});

function setup(gateOpts: AskGateOptions, ctrlOpts: Partial<CaptureControllerOptions> = {}) {
  const api: CaptureApi = {
    postEvents: vi.fn(async () => ({})),
    postTranscript: vi.fn(async () => ({})),
    postQA: vi.fn(async () => ({})),
    setOffRecord: vi.fn(async () => ({})),
    decide: vi.fn(async () => ({
      event_class: dr("event_class", "judgment_call"),
      screen_explains_it: dr("screen_explains_it", 0.1),
      ask_timing: dr("ask_timing", "ask_now"),
    })),
  };
  const voice = { promptTurn: vi.fn(), injectContext: vi.fn(), noteUserActivity: vi.fn(), setMuted: vi.fn(), isSpeaking: vi.fn(() => false) };
  const now = () => Date.now();
  const bus = createEventBus({ now: () => now() / 1000 });
  const gate = createAskGate({ now, ...gateOpts });
  const c = createCaptureController({
    api,
    voice: voice as unknown as CaptureVoice,
    bus,
    activity: createActivityTracker({ now }),
    gate,
    now,
    sessionId: "s_test",
    getT: () => now() / 1000,
    ...ctrlOpts,
  });
  c.start();
  const publish = (id: string) =>
    bus.publishOs({ type: "field_changed", entity: { kind: "invoice", id }, field: "cost_center", from: "4711", to: "0400" });
  return { c, gate, voice, api, publish };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe("active ask cadence in the capture loop", () => {
  it("three judgment events 25 s apart give 3 questions with exactly 1 guardrail question", async () => {
    const { c, gate, voice, publish } = setup({ minGapMs: 20_000 });
    await vi.advanceTimersByTimeAsync(3000);
    for (const id of ["4517", "4518", "4519"]) {
      publish(id);
      await vi.advanceTimersByTimeAsync(25_000);
    }
    expect(voice.promptTurn).toHaveBeenCalledTimes(3);
    expect(gate.stats()).toMatchObject({ asked: 3, guardrailAsked: 1, reasonAsked: 2 });
    expect(voice.promptTurn.mock.calls[1][1].ask).toBe("guardrail");
    expect(c.stats().debrief).toBe(0);
  });

  it("a question blocked only by the minimum gap waits instead of going to the debrief", async () => {
    const { c, voice, publish } = setup({ minGapMs: 20_000 });
    await vi.advanceTimersByTimeAsync(3000);
    publish("4517");
    await vi.advanceTimersByTimeAsync(5000);
    expect(voice.promptTurn).toHaveBeenCalledTimes(1);
    publish("4518");
    await vi.advanceTimersByTimeAsync(5000);
    expect(c.stats()).toMatchObject({ asked: 1, pending: 1, debrief: 0 });
    await vi.advanceTimersByTimeAsync(11_000);
    expect(voice.promptTurn).toHaveBeenCalledTimes(2);
    expect(c.stats()).toMatchObject({ asked: 2, pending: 0, debrief: 0 });
  });

  it("a gap wait longer than MAX_WAIT_MS goes to the debrief", async () => {
    const { c, publish } = setup({ minGapMs: 120_000 });
    await vi.advanceTimersByTimeAsync(3000);
    publish("4517");
    await vi.advanceTimersByTimeAsync(3000);
    publish("4518");
    await vi.advanceTimersByTimeAsync(MAX_WAIT_MS + 1000);
    expect(c.debrief().map((d) => d.why)).toEqual(["waited_too_long"]);
  });
});

describe("Agent Settings reach the gate, the controller and the voice overrides", () => {
  const settings = resolveSettings({
    question_interval_s: 120,
    guardrails_first: false,
    learn_shortcuts: false,
    voice_preset: "energetic",
    voice_speed: 1.2,
    off_record_phrase: "Pause Please",
  });

  it("maps every value", () => {
    const w = captureSettings(settings, true);
    expect(w.gate).toEqual({ minGapMs: 120_000, guardrailsFirst: false });
    expect(w.controller).toEqual({ offRecordPhrase: "pause please", learnShortcuts: false });
    expect(w.voice.overrides.tts).toEqual({ speed: 1.2, stability: 0.3 });
    expect(w.voice.overrides.agent?.prompt.prompt).toContain('"pause please"');
    expect(w.voice.overrides.agent?.firstMessage).toContain("Say 'pause please'");
    expect(w.voice.notice).toBeNull();
    const speedOnly = captureSettings(resolveSettings({}), false);
    expect(speedOnly.voice.overrides).toEqual({ tts: { speed: 1 } });
    expect(speedOnly.voice.notice).not.toBeNull();
  });

  it("the gate gets the gap, the controller the off-record phrase", async () => {
    const w = captureSettings(settings, false);
    const { c, gate, api } = setup(w.gate, w.controller);
    expect(gate.stats().minGapMs).toBe(120_000);
    c.onTranscript("expert", "ok, pause please for a moment");
    expect(c.isOffRecord()).toBe(true);
    expect(api.setOffRecord).toHaveBeenCalledTimes(1);
  });
});
