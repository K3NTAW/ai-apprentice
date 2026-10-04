// T-0252 capture fixes: End task ends the session, one vision request in flight with a visible failure counter,
// the 'Back on the record' button and the custom off-record phrase.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivityTracker } from "@/lib/perception/activity";
import { createEventBus } from "@/lib/perception/eventBus";
import { createAskGate } from "@/lib/voice/askGate";
import { createCaptureController, type CaptureApi, type CaptureVoice, type FrameIn } from "@/lib/capture/controller";
import { endThenNavigate } from "@/lib/capture/httpApi";
import CaptureConsole, { type CaptureConsoleProps } from "./CaptureConsole";

const noop = () => {};
const props = (over: Partial<CaptureConsoleProps> = {}): CaptureConsoleProps => ({
  running: true,
  starting: false,
  offRecord: false,
  sharing: false,
  shareWarning: null,
  expert: "Sabine",
  lastQuestion: null,
  asked: 0,
  guardrailAsked: 0,
  savedForDebrief: 0,
  feed: [],
  companion: { status: "not connected", permissions: null, onPair: () => true },
  onExpertChange: noop,
  onStart: noop,
  onEnd: noop,
  onTogglePause: noop,
  onToggleOffRecord: noop,
  onToggleShare: noop,
  ...over,
});

function controller(postFrame: CaptureApi["postFrame"], offRecordPhrase?: string) {
  const api: CaptureApi = {
    postEvents: vi.fn(async () => ({})),
    postTranscript: vi.fn(async () => ({})),
    postQA: vi.fn(async () => ({})),
    setOffRecord: vi.fn(async () => ({})),
    decide: vi.fn(async () => ({})),
    postFrame,
  };
  const voice = { promptTurn: vi.fn(), injectContext: vi.fn(), noteUserActivity: vi.fn(), setMuted: vi.fn(), isSpeaking: () => false };
  const now = () => Date.now();
  const c = createCaptureController({
    api,
    voice: voice as unknown as CaptureVoice,
    bus: createEventBus({ now: () => now() / 1000 }),
    activity: createActivityTracker({ now }),
    gate: createAskGate({ now }),
    now,
    sessionId: "s1",
    getT: () => now() / 1000,
    ...(offRecordPhrase ? { offRecordPhrase } : {}),
  });
  c.start();
  return { c, api, voice };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => vi.useRealTimers());

describe("End task", () => {
  it("calls POST /api/session/<id>/end before opening the debrief, and still navigates when it fails", async () => {
    const log: string[] = [];
    const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
      log.push(`${init?.method} ${url}`);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await endThenNavigate("s_42", () => log.push("navigate"), fetchImpl);
    expect(log).toEqual(["POST /api/session/s_42/end", "navigate"]);
    const failing = vi.fn(async () => new Response("{}", { status: 500 })) as unknown as typeof fetch;
    const nav = vi.fn();
    vi.spyOn(console, "warn").mockImplementation(noop);
    await endThenNavigate("s_42", nav, failing);
    expect(nav).toHaveBeenCalledTimes(1);
  });
});

describe("vision in Capture", () => {
  it("keeps one request in flight, drops frames while busy and sends only the latest next", async () => {
    const resolvers: (() => void)[] = [];
    const sent: number[] = [];
    const postFrame = vi.fn((f: FrameIn) => {
      sent.push(f.t);
      return new Promise<{ events: [] }>((res) => resolvers.push(() => res({ events: [] })));
    });
    const { c } = controller(postFrame);
    const frame = (t: number) => void c.onFrame({ jpegBase64: "AAAA", t });
    frame(1);
    frame(2);
    frame(3);
    frame(4);
    expect(sent).toEqual([1]);
    resolvers.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([1, 4]);
    resolvers.shift()!();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([1, 4]);
  });

  it("counts failed requests (not the daily cap) and the console shows the counter", async () => {
    let fail: Error = new Error("/api/vision 502");
    const { c } = controller(vi.fn(async () => Promise.reject(fail)));
    await c.onFrame({ jpegBase64: "A", t: 1 });
    await c.onFrame({ jpegBase64: "A", t: 2 });
    expect(c.stats().visionFailures).toBe(2);
    fail = new Error("/api/vision 429");
    await c.onFrame({ jpegBase64: "A", t: 3 });
    expect(c.stats().visionFailures).toBe(2);
    expect(c.dailyLimit()).toEqual(["vision"]);
    const html = renderToStaticMarkup(<CaptureConsole {...props({ visionFailures: 2 })} />);
    expect(html).toContain('data-testid="vision-failures"');
    expect(html).toContain("Vision failed 2×");
    expect(renderToStaticMarkup(<CaptureConsole {...props()} />)).not.toContain("vision-failures");
  });
});

describe("Back on the record", () => {
  it("the console shows a large Back on the record button only while off the record", () => {
    const off = renderToStaticMarkup(<CaptureConsole {...props({ offRecord: true })} />);
    expect(off).toContain('data-testid="back-on-record"');
    expect(renderToStaticMarkup(<CaptureConsole {...props()} />)).not.toContain("back-on-record");
  });

  it("the button's toggle resumes without the voice agent, and the custom phrase pauses", () => {
    const { c, api, voice } = controller(undefined, "pause please");
    c.onTranscript("expert", "now off the record");
    expect(c.isOffRecord()).toBe(false);
    c.onTranscript("expert", "Pause   please, a moment");
    expect(c.isOffRecord()).toBe(true);
    expect(voice.setMuted).toHaveBeenLastCalledWith(true);
    // What the button calls (CaptureApp toggleOffRecord): no transcript needed, the mic is muted anyway.
    c.setOffRecord(!c.isOffRecord());
    expect(c.isOffRecord()).toBe(false);
    expect(voice.setMuted).toHaveBeenLastCalledWith(false);
    expect(api.setOffRecord).toHaveBeenCalledTimes(2);
  });
});
