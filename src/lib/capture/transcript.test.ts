// T-0240: every expert utterance stored (timestamped, redacted, not off the record), narration linked to events,
// the active gate holding for typing and skipping explained events, and the dock's live line, ack and feed.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivityTracker } from "@/lib/perception/activity";
import { createEventBus } from "@/lib/perception/eventBus";
import { createAskGate } from "@/lib/voice/askGate";
import type { DecisionQuestionName, DecisionResult, TranscriptEntry } from "@/lib/types";
import { ACK_TEXT, NOW_MIN_MS, createCaptureController, type CaptureApi, type CaptureCompanion, type CaptureVoice } from "./controller";

const dr = (question: DecisionQuestionName, answer: string | number): DecisionResult => ({ question, answer, confidence: 0.9, provider: "heuristic", latency_ms: 1 });
const judgment = async () => ({
  event_class: dr("event_class", "judgment_call"),
  screen_explains_it: dr("screen_explains_it", 0.1),
  ask_timing: dr("ask_timing", "ask_now"),
});

function setup() {
  const api = {
    postEvents: vi.fn<CaptureApi["postEvents"]>(async () => ({})),
    postTranscript: vi.fn<CaptureApi["postTranscript"]>(async () => ({})),
    postQA: vi.fn<CaptureApi["postQA"]>(async () => ({})),
    setOffRecord: vi.fn<CaptureApi["setOffRecord"]>(async () => ({})),
    decide: vi.fn<CaptureApi["decide"]>(judgment),
  };
  const voice = { promptTurn: vi.fn(), injectContext: vi.fn(), noteUserActivity: vi.fn(), setMuted: vi.fn(), isSpeaking: vi.fn(() => false) };
  const companion = {
    buddyState: vi.fn(() => true),
    buddySay: vi.fn(() => true),
    buddyPoint: vi.fn(() => true),
    buddyClear: vi.fn(() => true),
    sessionState: vi.fn(() => true),
    dockShow: vi.fn(() => true),
    dockHide: vi.fn(() => true),
    dockLearned: vi.fn(() => true),
    dockNow: vi.fn((..._a: [string, string?]) => true),
    dockAck: vi.fn((_t: string) => true),
  };
  const now = () => Date.now();
  const t0 = Date.now();
  const getT = () => (Date.now() - t0) / 1000;
  const bus = createEventBus({ now: getT });
  const activity = createActivityTracker({ now });
  const gate = createAskGate({ now });
  const c = createCaptureController({
    api,
    voice: voice as unknown as CaptureVoice,
    bus,
    activity,
    gate,
    now,
    sessionId: "s_t",
    getT,
    companion: companion as unknown as CaptureCompanion,
    session: { expert: "Sabine" },
    shortcutLearning: true,
  });
  c.start();
  const publish = (id = "4471") =>
    bus.publishOs({ type: "field_changed", app: "Excel", entity: { kind: "invoice", id }, field: "cost_center", from: "4711", to: "0400" })!;
  const entries = () => api.postTranscript.mock.calls.flatMap(([e]) => e as TranscriptEntry[]);
  return { api, voice, companion, c, publish, entries, activity };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-04T10:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

describe("continuous transcript", () => {
  it("stores every expert utterance with its session time, redacted, not only answers", async () => {
    const { c, entries } = setup();
    await vi.advanceTimersByTimeAsync(4000);
    c.onTranscript("expert", "Now I open the supplier list, mail me at anna.muster@example.com");
    await vi.advanceTimersByTimeAsync(2500);
    c.onTranscript("expert", "and then the next invoice");
    await flush();
    const e = entries();
    expect(e).toHaveLength(2);
    expect(e[0]).toMatchObject({ speaker: "expert", phase: "capture", redacted: true, t: 4 });
    expect(e[0].text).not.toContain("anna.muster@example.com");
    expect(e[1].t).toBe(6.5);
  });

  it("drops a repeated final within 3 s (dedupe) but keeps a later repeat", async () => {
    const { c, entries } = setup();
    c.onTranscript("expert", "Okay.");
    c.onTranscript("expert", "okay. ");
    await vi.advanceTimersByTimeAsync(3500);
    c.onTranscript("expert", "Okay.");
    await flush();
    expect(entries()).toHaveLength(2);
  });

  it("off the record: the phrase itself and everything until resumed is dropped", async () => {
    const { c, entries, companion } = setup();
    c.onTranscript("expert", "first part");
    c.onTranscript("expert", "this is off the record");
    c.onTranscript("expert", "my salary is secret because reasons");
    c.onTranscript("expert", "back on the record");
    c.onTranscript("expert", "second part");
    await flush();
    expect(entries().map((e) => e.text)).toEqual(["first part", "second part"]);
    expect(companion.dockAck).not.toHaveBeenCalled();
  });
});

describe("narration and the active gate", () => {
  it("links an unprompted explanation to the event just done: no question, a 'got it' chip and a learned line", async () => {
    const { c, voice, companion, publish } = setup();
    await vi.advanceTimersByTimeAsync(5000);
    publish();
    await flush();
    c.onTranscript("expert", "I always move equipment to 0400 because 4711 is closed for capex.");
    await vi.advanceTimersByTimeAsync(10_000);
    expect(voice.promptTurn).not.toHaveBeenCalled();
    expect(companion.dockAck).toHaveBeenCalledWith(ACK_TEXT);
    expect(companion.dockLearned).toHaveBeenCalledWith("step", expect.stringContaining("4711 is closed for capex"));
    expect(c.debrief()).toEqual([]);
  });

  it("holds while typing, then asks at a real pause about an unexplained event", async () => {
    const { c, voice, publish } = setup();
    await vi.advanceTimersByTimeAsync(5000);
    publish();
    await flush();
    c.noteKeystroke();
    await vi.advanceTimersByTimeAsync(1500);
    expect(voice.promptTurn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(voice.promptTurn).toHaveBeenCalledTimes(1);
  });
});

describe("dock live line", () => {
  it("dock.now updates with each event (redacted, rate-limited, latest wins) and clears off the record", async () => {
    const { c, companion, publish } = setup();
    publish("4471");
    await flush();
    expect(companion.dockNow).toHaveBeenLastCalledWith("cost center of invoice 4471 changed from 4711 to 0400", "Excel");
    publish("5005");
    publish("6006");
    await flush();
    expect(companion.dockNow).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(NOW_MIN_MS);
    expect(companion.dockNow).toHaveBeenCalledTimes(2);
    expect(companion.dockNow.mock.calls[1][0]).toContain("6006");
    c.setOffRecord(true);
    expect(companion.dockNow).toHaveBeenLastCalledWith("", undefined);
    const n = companion.dockNow.mock.calls.length;
    publish("7007");
    await vi.advanceTimersByTimeAsync(2000);
    expect(companion.dockNow.mock.calls.length).toBe(n);
  });

  it("answers feed the learned list too", async () => {
    const { c, companion, publish } = setup();
    await vi.advanceTimersByTimeAsync(5000);
    publish();
    await vi.advanceTimersByTimeAsync(2500);
    c.onTranscript("agent", "Why 0400?");
    c.onTranscript("expert", "Budget owner said so");
    await flush();
    expect(companion.dockLearned).toHaveBeenCalledWith("step", expect.stringContaining("Budget owner said so"));
  });
});
