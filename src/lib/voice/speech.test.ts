// Speech-aware timing (T-0252 P0-1): the VAD signal drives 'speaking' with a 600 ms release, and the ask gate
// never asks while the expert talks over a still screen.
import { describe, expect, it } from "vitest";
import { createActivityTracker, VAD_RELEASE_MS } from "@/lib/perception/activity";
import type { DecisionResult, ScreenEvent } from "@/lib/types";
import { createAskGate } from "./askGate";

const r = (question: string, answer: string | number): DecisionResult =>
  ({ question, answer, confidence: 1, provider: "heuristic", latency_ms: 0 }) as DecisionResult;
const event: ScreenEvent = { id: "e1", t: 1, source: "vision", type: "field_changed", entity: { kind: "invoice", id: "4517" } };

describe("speech-aware timing", () => {
  it("the speaking flag follows the VAD score with a 600 ms release", () => {
    let t = 10_000;
    const a = createActivityTracker({ now: () => t });
    expect(a.snapshot().speaking).toBe(false);
    a.noteVad(0.9);
    expect(a.snapshot().speaking).toBe(true);
    t += 300;
    a.noteVad(0.2);
    expect(a.snapshot().speaking).toBe(true);
    t += VAD_RELEASE_MS - 300 - 1;
    expect(a.snapshot().speaking).toBe(true);
    t += 1;
    const s = a.snapshot();
    expect(s.speaking).toBe(false);
    expect(s.speech_silence_ms).toBe(0);
    t += 1500;
    expect(a.snapshot().speech_silence_ms).toBe(1500);
  });

  it("5 s of speech with a still screen never yields a question", () => {
    let t = 100_000;
    const a = createActivityTracker({ now: () => t });
    const gate = createAskGate({ now: () => t });
    for (let ms = 0; ms <= 5000; ms += 100) {
      // Speech with natural micro-pauses: every fifth VAD frame is quiet.
      a.noteVad(ms % 500 === 0 ? 0.1 : 0.8);
      const d = gate.consider({
        event,
        eventClass: r("event_class", "judgment_call"),
        screenExplains: r("screen_explains_it", 0),
        timing: r("ask_timing", "ask_now"),
        activity: a.snapshot(),
        agentSpeaking: false,
      });
      expect(d.action).not.toBe("ask_now");
      t += 100;
    }
  });
});
