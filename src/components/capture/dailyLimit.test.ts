// Capture on a 429 daily_limit from vision or decide: the controller records the kind, stops calling it,
// and the side panel notice names it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivityTracker } from "@/lib/perception/activity";
import { createEventBus } from "@/lib/perception/eventBus";
import { createAskGate } from "@/lib/voice/askGate";
import { createCaptureController, isDailyLimitError, type CaptureApi, type CaptureVoice } from "@/lib/capture/controller";
import { dailyLimitNotice, voiceStartNotice } from "./dailyLimit";

const limit = (url: string) => new Error(`${url} 429`);

function setup(api: Partial<CaptureApi>) {
  const full: CaptureApi = {
    postEvents: vi.fn(async () => ({})),
    postTranscript: vi.fn(async () => ({})),
    postQA: vi.fn(async () => ({})),
    setOffRecord: vi.fn(async () => ({})),
    decide: vi.fn(async () => ({})),
    ...api,
  };
  const voice: CaptureVoice = {
    promptTurn: vi.fn(),
    injectContext: vi.fn(),
    noteUserActivity: vi.fn(),
    setMuted: vi.fn(),
    isSpeaking: () => false,
  };
  const now = () => Date.now();
  const bus = createEventBus({ now: () => now() / 1000 });
  const onChange = vi.fn();
  const onError = vi.fn();
  const c = createCaptureController({
    api: full,
    voice,
    bus,
    activity: createActivityTracker({ now }),
    gate: createAskGate({ now }),
    now,
    sessionId: "s_test",
    getT: () => now() / 1000,
    onChange,
    onError,
  });
  c.start();
  const publish = (id: string) =>
    bus.publishOs({ type: "field_changed", entity: { kind: "invoice", id }, field: "cost_center", from: "4711", to: "0400" });
  return { c, full, publish, onChange, onError };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("capture daily limit", () => {
  it("recognises the http adapter's 429 error", () => {
    expect(isDailyLimitError(limit("/api/vision"))).toBe(true);
    expect(isDailyLimitError(new Error("/api/decide 500"))).toBe(false);
  });

  it("a 429 from vision shows the notice and stops posting frames", async () => {
    const postFrame = vi.fn(async () => {
      throw limit("/api/vision");
    });
    const { c, onError } = setup({ postFrame });
    await c.onFrame({ jpegBase64: "x", t: 1 });
    expect(c.dailyLimit()).toEqual(["vision"]);
    expect(onError).not.toHaveBeenCalled();
    await c.onFrame({ jpegBase64: "x", t: 2 });
    expect(postFrame).toHaveBeenCalledTimes(1);
    expect(dailyLimitNotice(c.dailyLimit())).toMatch(/Daily limit reached for screen reading/);
  });

  it("a 429 from decide shows the notice and saves later steps for the debrief without calling decide", async () => {
    const decide = vi.fn(async () => {
      throw limit("/api/decide");
    });
    const { c, publish } = setup({ decide });
    publish("1");
    await vi.advanceTimersByTimeAsync(0);
    expect(c.dailyLimit()).toEqual(["decide"]);
    publish("2");
    await vi.advanceTimersByTimeAsync(0);
    expect(decide).toHaveBeenCalledTimes(1);
    expect(c.debrief().map((d) => d.why)).toEqual(["daily_limit", "daily_limit"]);
    expect(dailyLimitNotice(c.dailyLimit())).toMatch(/question decisions.*saved for the debrief/);
  });

  it("no notice without a limit; the voice limit gets its own wording", () => {
    expect(dailyLimitNotice([])).toBeNull();
    expect(voiceStartNotice("daily_limit", "Text mode.")).toMatch(/^Daily voice limit reached/);
    expect(voiceStartNotice("mic_denied", "Text mode.")).toBe("Voice could not start (mic_denied). Text mode.");
  });
});
