import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivityTracker } from "@/lib/perception/activity";
import { createEventBus } from "@/lib/perception/eventBus";
import { createAskGate } from "@/lib/voice/askGate";
import { createCaptureController, type CaptureApi, type CaptureVoice } from "@/lib/capture/controller";
import type { ScreenEvent } from "@/lib/types";
import { CHORD_LINK_MS, createChordLinker, isAllowedChord } from "./chord";
import { parseCompanionMessage } from "./client";

const chordMsg = (chord: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ type: "chord", t: 1_000, chord, app: "Microsoft Outlook", ...extra });

describe("chord validation (A6)", () => {
  it("accepts Cmd, Ctrl, Alt/Option chords and F1-F24", () => {
    for (const c of ["Cmd+Shift+T", "Ctrl+Enter", "Alt+Tab", "Option+Escape", "F5", "F24", "Shift+F3"]) expect(isAllowedChord(c)).toBe(true);
  });
  it("rejects plain typing, Shift+letter, F25 and oversize chords", () => {
    for (const c of ["a", "A", "7", ".", "Shift+A", "Shift+1", "Enter", "Tab", "F25", "F0", "", "Cmd+", `Cmd+${"x".repeat(60)}`]) {
      expect(isAllowedChord(c)).toBe(false);
    }
  });
  it("parseCompanionMessage drops plain letters, Shift+letter and a non-finite t silently", () => {
    expect(parseCompanionMessage(chordMsg("Cmd+Enter"))).toEqual({ type: "chord", t: 1_000, chord: "Cmd+Enter", app: "Microsoft Outlook" });
    expect(parseCompanionMessage(chordMsg("k"))).toBeNull();
    expect(parseCompanionMessage(chordMsg("Shift+K"))).toBeNull();
    expect(parseCompanionMessage(chordMsg("Cmd+K", { t: "soon" }))).toBeNull();
    expect(parseCompanionMessage(chordMsg("Cmd+K", { app: 3 }))).toBeNull();
    const long = parseCompanionMessage(chordMsg("Cmd+K", { app: "x".repeat(500) }));
    expect(long && long.type === "chord" && long.app.length).toBe(200);
  });
});

describe("chord linker (A4)", () => {
  const vision = (id: string): ScreenEvent => ({ id, t: 0, source: "vision", type: "item_sent", entity: { kind: "email", id: "Offer" } });
  it("links vision events within the window to the most recent chord only", () => {
    const l = createChordLinker();
    expect(l.onChord({ chord: "Cmd+Enter", app: "Outlook" }, 0, 10)).toBeNull();
    l.onVision(vision("a"), 500);
    const first = l.onChord({ chord: "Cmd+D", app: "Outlook" }, 1000, 11);
    expect(first?.effects.map((e) => e.id)).toEqual(["a"]);
    l.onVision(vision("b"), 1500);
    const second = l.onVision(vision("c"), 1000 + CHORD_LINK_MS + 1);
    expect(second?.chord).toBe("Cmd+D");
    expect(second?.effects.map((e) => e.id)).toEqual(["b"]);
  });
  it("cancel drops the pending chord", () => {
    const l = createChordLinker();
    l.onChord({ chord: "Cmd+Enter", app: "Outlook" }, 0, 0);
    l.cancel();
    expect(l.poll(10_000)).toBeNull();
  });
});

describe("chords in Capture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000_000);
  });
  afterEach(() => vi.useRealTimers());

  function setup() {
    const api = {
      postEvents: vi.fn<CaptureApi["postEvents"]>(async () => ({})),
      postTranscript: vi.fn(async () => ({})),
      postQA: vi.fn(async () => ({})),
      setOffRecord: vi.fn(async () => ({})),
      decide: vi.fn<CaptureApi["decide"]>(async () => ({})),
    };
    const voice = { promptTurn: vi.fn(), injectContext: vi.fn(), noteUserActivity: vi.fn(), setMuted: vi.fn(), isSpeaking: vi.fn(() => false) };
    const now = () => Date.now();
    const bus = createEventBus({ now: () => now() / 1000 });
    const c = createCaptureController({
      api,
      voice: voice as unknown as CaptureVoice,
      bus,
      activity: createActivityTracker({ now }),
      gate: createAskGate({ now }),
      now,
      sessionId: "s",
      getT: () => now() / 1000,
    });
    c.start();
    const posted = () => api.postEvents.mock.calls.map((call) => call[0][0]);
    return { api, bus, c, posted };
  }

  it("a chord while capturing becomes a shortcut_used event with chord and app, linked to the vision events within 2 s", async () => {
    const { bus, c, posted } = setup();
    c.onCompanionChord({ t: 1, chord: "Cmd+Enter", app: "Microsoft Outlook" });
    await vi.advanceTimersByTimeAsync(800);
    const [sent] = bus.publishVision([{ type: "item_sent", entity: { kind: "email", id: "Offer Q3" }, to: "controller" }]);
    await vi.advanceTimersByTimeAsync(2500);
    const late = bus.publishVision([{ type: "item_deleted", entity: { kind: "email", id: "Spam" } }]);
    await vi.advanceTimersByTimeAsync(0);
    const sc = posted().find((e) => e.type === "shortcut_used")!;
    expect(sc).toMatchObject({ source: "os", type: "shortcut_used", chord: "Cmd+Enter", app: "Microsoft Outlook", effect_ids: [sent.id] });
    expect(sc.effect_ids).not.toContain(late[0].id);
    expect(sc.t).toBe(1000);
  });

  it("nothing while off the record; a pending chord is cancelled at the boundary", async () => {
    const { c, posted } = setup();
    c.onCompanionChord({ t: 1, chord: "Cmd+Enter", app: "Outlook" });
    c.setOffRecord(true);
    c.onCompanionChord({ t: 2, chord: "Cmd+D", app: "Outlook" });
    await vi.advanceTimersByTimeAsync(5000);
    c.setOffRecord(false);
    await vi.advanceTimersByTimeAsync(5000);
    expect(posted().filter((e) => e.type === "shortcut_used")).toEqual([]);
  });

  it("is off with the rollback switch", async () => {
    const api = { postEvents: vi.fn(async () => ({})), postTranscript: vi.fn(), postQA: vi.fn(), setOffRecord: vi.fn(), decide: vi.fn() };
    const now = () => Date.now();
    const c = createCaptureController({
      api: api as unknown as CaptureApi,
      voice: { promptTurn: vi.fn(), injectContext: vi.fn(), noteUserActivity: vi.fn(), setMuted: vi.fn(), isSpeaking: () => false },
      bus: createEventBus({ now: () => now() / 1000 }),
      activity: createActivityTracker({ now }),
      gate: createAskGate({ now }),
      now,
      sessionId: "s",
      getT: () => now() / 1000,
      shortcutLearning: false,
    });
    c.start();
    c.onCompanionChord({ t: 1, chord: "Cmd+Enter", app: "Outlook" });
    await vi.advanceTimersByTimeAsync(5000);
    expect(api.postEvents).not.toHaveBeenCalled();
  });
});
