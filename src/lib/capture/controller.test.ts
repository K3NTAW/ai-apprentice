import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createActivityTracker } from "@/lib/perception/activity";
import { createEventBus } from "@/lib/perception/eventBus";
import { createAskGate } from "@/lib/voice/askGate";
import type { DecisionQuestionName, DecisionResult } from "@/lib/types";
import { createCaptureController, type CaptureApi, type CaptureCompanion, type CaptureVoice } from "./controller";
import type { SessionAgent } from "@/lib/companion/agentState";

const dr = (question: DecisionQuestionName, answer: string | number): DecisionResult => ({
  question,
  answer,
  confidence: 0.9,
  provider: "heuristic",
  latency_ms: 1,
});

const judgment = () => ({
  event_class: dr("event_class", "judgment_call"),
  screen_explains_it: dr("screen_explains_it", 0.1),
  ask_timing: dr("ask_timing", "ask_now"),
});

function setup(opts: { decide?: CaptureApi["decide"]; agentSpeaking?: boolean; companion?: CaptureCompanion } = {}) {
  const api = {
    postEvents: vi.fn<CaptureApi["postEvents"]>(async () => ({})),
    postTranscript: vi.fn<CaptureApi["postTranscript"]>(async () => ({})),
    postQA: vi.fn<CaptureApi["postQA"]>(async () => ({})),
    setOffRecord: vi.fn<CaptureApi["setOffRecord"]>(async () => ({})),
    decide: vi.fn<CaptureApi["decide"]>(opts.decide ?? (async () => judgment())),
    postFrame: vi.fn<NonNullable<CaptureApi["postFrame"]>>(async () => ({ events: [] })),
  };
  const voice: { [K in keyof CaptureVoice]: ReturnType<typeof vi.fn> } = {
    promptTurn: vi.fn(),
    injectContext: vi.fn(),
    noteUserActivity: vi.fn(),
    setMuted: vi.fn(),
    isSpeaking: vi.fn(() => opts.agentSpeaking ?? false),
  };
  const now = () => Date.now();
  const bus = createEventBus({ now: () => now() / 1000 });
  const activity = createActivityTracker({ now });
  const gate = createAskGate({ now });
  const onError = vi.fn();
  const c = createCaptureController({
    api,
    voice: voice as unknown as CaptureVoice,
    bus,
    activity,
    gate,
    now,
    sessionId: "s_test",
    getT: () => now() / 1000,
    onError,
    companion: opts.companion,
    session: { expert: "Sabine", appUrl: "https://ai-apprentice.vercel.app/capture" },
  });
  c.start();
  const publish = (id = "4471") =>
    bus.publishOs({ type: "field_changed", entity: { kind: "invoice", id }, field: "cost_center", from: "4711", to: "0400" })!;
  return { api, voice, bus, c, publish, onError };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});
afterEach(() => {
  vi.useRealTimers();
});

describe("capture controller", () => {
  it("posts every event and sends it to the agent as context", async () => {
    const { api, voice, publish } = setup();
    const ev = publish();
    await flush();
    expect(api.postEvents).toHaveBeenCalledWith([ev]);
    expect(voice.injectContext).toHaveBeenCalledWith("cost center of invoice 4471 changed from 4711 to 0400");
    const state = api.decide.mock.calls[0][1] as Record<string, unknown>;
    expect(api.decide.mock.calls[0][0]).toEqual(["event_class", "screen_explains_it", "ask_timing"]);
    expect(state).toMatchObject({ event: ev, typing: false, questions_asked_last_10min: 0 });
  });

  it("does not ask while typing, then asks after silence naming the on-screen object", async () => {
    const { voice, c, publish } = setup();
    c.noteKeystroke();
    publish();
    await flush();
    expect(voice.promptTurn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1000);
    expect(voice.promptTurn).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1500);
    expect(voice.promptTurn).toHaveBeenCalledTimes(1);
    const [turn] = voice.promptTurn.mock.calls[0];
    expect(turn).toContain("[SCREEN_EVENT]");
    expect(turn).toContain("invoice 4471");
    expect(turn).toContain("cost center");
    expect(c.stats().asked).toBe(1);
  });

  it("pings user activity while typing at most once per second", async () => {
    const { voice, c } = setup();
    for (let i = 0; i < 5; i++) {
      c.noteKeystroke();
      await vi.advanceTimersByTimeAsync(150);
    }
    expect(voice.noteUserActivity).toHaveBeenCalledTimes(1);
    c.noteKeystroke();
    await vi.advanceTimersByTimeAsync(300);
    expect(voice.noteUserActivity).toHaveBeenCalledTimes(2);
  });

  it("closes the QAPair with the next expert utterance and posts it with event_id and timestamps", async () => {
    const { api, c, publish } = setup();
    await vi.advanceTimersByTimeAsync(2000);
    const ev = publish();
    await flush();
    c.onTranscript("agent", "Why move invoice 4471 to cost center 0400?");
    await vi.advanceTimersByTimeAsync(3000);
    c.onTranscript("expert", "Equipment over 5000 is always capex.");
    await flush();
    expect(api.postQA).toHaveBeenCalledTimes(1);
    const qa = api.postQA.mock.calls[0][0] as Record<string, unknown>;
    expect(qa).toMatchObject({
      event_id: ev.id,
      question: "Why move invoice 4471 to cost center 0400?",
      answer: "Equipment over 5000 is always capex.",
      phase: "capture",
      about: "reason",
    });
    expect(qa.t_answer as number).toBeGreaterThan(qa.t_question as number);
    expect(api.postTranscript).toHaveBeenCalledTimes(2);
    c.onTranscript("expert", "Anything else?");
    await flush();
    expect(api.postQA).toHaveBeenCalledTimes(1);
  });

  it("sends the sixth question to the debrief list", async () => {
    const { voice, c, publish } = setup();
    await vi.advanceTimersByTimeAsync(2000);
    for (let i = 0; i < 6; i++) {
      publish(String(5000 + i));
      await flush();
      await vi.advanceTimersByTimeAsync(21000);
    }
    expect(voice.promptTurn).toHaveBeenCalledTimes(5);
    expect(c.debrief()).toHaveLength(1);
    expect(c.debrief()[0]).toMatchObject({ why: "budget", event: { entity: { id: "5005" } } });
    expect(c.stats()).toMatchObject({ asked: 5, debrief: 1 });
    expect(c.stats().guardrailAsked).toBeGreaterThanOrEqual(1);
  });

  it("saves an event for the debrief after waiting 20 s", async () => {
    const { voice, c, publish } = setup({ agentSpeaking: true });
    await vi.advanceTimersByTimeAsync(2000);
    publish();
    await flush();
    expect(c.stats().pending).toBe(1);
    await vi.advanceTimersByTimeAsync(20500);
    expect(voice.promptTurn).not.toHaveBeenCalled();
    expect(c.debrief()[0]).toMatchObject({ why: "waited_too_long" });
    expect(c.stats().pending).toBe(0);
  });

  it("off the record (button or client tool) stops all posts and mutes the voice until resumed", async () => {
    const { api, voice, bus, c, publish } = setup();
    const capture = { pause: vi.fn(), resume: vi.fn() };
    c.setCapture(capture);
    c.noteKeystroke();
    publish("4471");
    await flush();
    api.postEvents.mockClear();
    api.postTranscript.mockClear();

    vi.advanceTimersByTime(200);
    c.setOffRecord(true);
    expect(api.setOffRecord).toHaveBeenLastCalledWith({ from: 1000.2 });
    expect(bus.isPaused()).toBe(true);
    expect(voice.setMuted).toHaveBeenLastCalledWith(true);
    expect(capture.pause).toHaveBeenCalledTimes(1);
    expect(c.stats().offRecord).toBe(true);

    expect(publish("4498")).toBeUndefined();
    c.onTranscript("expert", "the supplier owes us a favour");
    c.onTranscript("agent", "Paused.");
    await c.onFrame({ jpegBase64: "abc", t: 1 });
    await vi.advanceTimersByTimeAsync(10000);
    expect(api.postEvents).not.toHaveBeenCalled();
    expect(api.postTranscript).not.toHaveBeenCalled();
    expect(api.postFrame).not.toHaveBeenCalled();
    expect(api.postQA).not.toHaveBeenCalled();
    expect(voice.promptTurn).not.toHaveBeenCalled();

    c.setOffRecord(false);
    expect(api.setOffRecord).toHaveBeenLastCalledWith({ from: 1000.2, to: 1010.2 });
    expect(api.setOffRecord).toHaveBeenCalledTimes(2);
    expect(voice.setMuted).toHaveBeenLastCalledWith(false);
    expect(capture.resume).toHaveBeenCalledTimes(1);
    expect(bus.isPaused()).toBe(false);
    await vi.advanceTimersByTimeAsync(500);
    expect(voice.promptTurn).toHaveBeenCalledTimes(1);
  });

  it("expert saying 'off the record' triggers it locally and 'back on the record' resumes", async () => {
    const { api, voice, bus, c } = setup();
    c.onTranscript("expert", "Let's go off the record for a second.");
    expect(c.isOffRecord()).toBe(true);
    expect(bus.isPaused()).toBe(true);
    expect(voice.setMuted).toHaveBeenLastCalledWith(true);
    c.onTranscript("expert", "This one is personal.");
    expect(api.postTranscript).not.toHaveBeenCalled();
    c.onTranscript("expert", "OK, back on the record.");
    expect(c.isOffRecord()).toBe(false);
    expect(api.setOffRecord).toHaveBeenCalledTimes(2);
    expect(api.postTranscript).not.toHaveBeenCalled();
    c.onTranscript("expert", "Now the next invoice.");
    expect(api.postTranscript).toHaveBeenCalledTimes(1);
  });

  it("a decide failure does not throw and saves the event for the debrief", async () => {
    const { voice, c, publish, onError } = setup({
      decide: async () => {
        throw new Error("decide down");
      },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(() => publish()).not.toThrow();
    await flush();
    await vi.advanceTimersByTimeAsync(2000);
    expect(voice.promptTurn).not.toHaveBeenCalled();
    expect(c.debrief()[0]).toMatchObject({ why: "decide_failed" });
    expect(onError).toHaveBeenCalledWith("decide", expect.any(Error));
  });

  it("a companion app event is stored as a redacted os app_switched ScreenEvent", async () => {
    const { api, bus, c } = setup();
    c.onCompanionApp({ app: "Microsoft Outlook", title: "Re: offer for anna.meier@example.com" });
    await flush();
    const [ev] = bus.all();
    expect(ev).toMatchObject({ source: "os", type: "app_switched", app: "Microsoft Outlook", entity: { kind: "app", id: "Microsoft Outlook" } });
    expect(ev.window).toContain("Re: offer for");
    expect(ev.window).not.toContain("anna.meier@example.com");
    expect(api.postEvents).toHaveBeenCalledWith([ev]);
    expect(JSON.stringify(api.postEvents.mock.calls)).not.toContain("anna.meier@example.com");
    expect(c.feed()[0]).toBe(ev);
  });

  it("companion typing holds a question; idle releases it", async () => {
    const { voice, c, publish } = setup();
    vi.advanceTimersByTime(3000);
    c.onCompanionActivity({ typing: true, pointer: false, idle_ms: 0 });
    publish();
    await flush();
    expect(voice.promptTurn).not.toHaveBeenCalled();
    expect(voice.noteUserActivity).toHaveBeenCalled();
    c.onCompanionActivity({ typing: false, pointer: false, idle_ms: 2000 });
    vi.advanceTimersByTime(500);
    expect(voice.promptTurn).toHaveBeenCalledTimes(1);
  });

  it("stale or disconnected companion activity falls back to the browser signals", async () => {
    const a = setup();
    vi.advanceTimersByTime(3000);
    a.c.onCompanionActivity({ typing: true, pointer: false, idle_ms: 0 });
    vi.advanceTimersByTime(1600);
    a.publish();
    await flush();
    expect(a.voice.promptTurn).toHaveBeenCalledTimes(1);

    a.c.stop();
    const b = setup();
    vi.advanceTimersByTime(3000);
    b.c.onCompanionActivity({ typing: true, pointer: false, idle_ms: 0 });
    b.c.onCompanionDisconnected();
    b.publish();
    await flush();
    expect(b.voice.promptTurn).toHaveBeenCalledTimes(1);
  });

  it("nothing companion-derived is stored or used while off the record, and it resumes cleanly", async () => {
    const { api, bus, voice, c } = setup();
    c.setOffRecord(true);
    voice.noteUserActivity.mockClear();
    c.onCompanionApp({ app: "Microsoft Excel", title: "Salaries.xlsx" });
    c.onCompanionActivity({ typing: true, pointer: true, idle_ms: 0 });
    await flush();
    expect(bus.all()).toEqual([]);
    expect(api.postEvents).not.toHaveBeenCalled();
    expect(c.feed()).toEqual([]);
    expect(voice.noteUserActivity).not.toHaveBeenCalled();
    c.setOffRecord(false);
    c.onCompanionApp({ app: "Microsoft Outlook", title: "Inbox" });
    await flush();
    expect(bus.all()).toHaveLength(1);
    expect(bus.all()[0]).toMatchObject({ source: "os", type: "app_switched", app: "Microsoft Outlook" });
  });

  describe("companion buddy", () => {
    function fakeCompanion() {
      const sent: { kind: string; arg: unknown }[] = [];
      const rec = (kind: string) => (arg?: unknown) => {
        sent.push({ kind, arg });
        return true;
      };
      const companion: CaptureCompanion = {
        buddyState: rec("state"),
        buddySay: rec("say"),
        buddyPoint: rec("point"),
        buddyClear: rec("clear"),
        sessionState: rec("session"),
      };
      return { companion, sent };
    }
    const rect = { x: 0.2, y: 0.3, w: 0.2, h: 0.05 };

    it("a question about an event with a rect sends buddy.say with the question and a glance point", async () => {
      const { companion, sent } = fakeCompanion();
      const { c, bus } = setup({ companion });
      expect(sent[0]).toEqual({ kind: "state", arg: "idle" });
      expect(sent[1]).toMatchObject({ kind: "session", arg: { mode: "capture", expert: "Sabine", asked: 0, off_record: false } });
      const ev = bus.publishOs({ type: "field_changed", entity: { kind: "invoice", id: "4471" }, field: "cost_center", from: "4711", to: "0400", rect })!;
      await vi.advanceTimersByTimeAsync(2500);
      expect(sent.filter((m) => m.kind === "point")).toEqual([
        { kind: "point", arg: { id: `glance_${ev.id}`, rect, style: "glance" } },
      ]);
      c.onTranscript("agent", "Why did you move invoice 4471 to 0400?");
      expect(sent.filter((m) => m.kind === "say")).toEqual([{ kind: "say", arg: "Why did you move invoice 4471 to 0400?" }]);
      c.onTranscript("expert", "It is capex.");
      expect(sent.filter((m) => m.kind === "say")).toHaveLength(1);
      expect(sent[sent.length - 1]).toMatchObject({
        kind: "session",
        arg: { asked: 1, last_question: "Why did you move invoice 4471 to 0400?", last_answer: "It is capex." },
      });
    });

    it("off the record only buddy.state 'paused' and session.state go out", async () => {
      const { companion, sent } = fakeCompanion();
      const { c, bus } = setup({ companion });
      sent.length = 0;
      c.setOffRecord(true);
      bus.publishOs({ type: "field_changed", entity: { kind: "invoice", id: "1" }, field: "cost_center", to: "0400", rect });
      c.onTranscript("agent", "Paused.");
      c.onTranscript("expert", "private");
      c.setAgent({ status: "connected", mode: "speaking" });
      await vi.advanceTimersByTimeAsync(10000);
      expect(sent.map((m) => m.kind).every((k) => k === "state" || k === "session")).toBe(true);
      expect(sent.filter((m) => m.kind === "state").map((m) => m.arg)).toEqual(["paused"]);
      expect(sent.filter((m) => m.kind === "session").every((m) => (m.arg as { off_record: boolean }).off_record)).toBe(true);
      c.setOffRecord(false);
      expect(sent[sent.length - 2]).toEqual({ kind: "state", arg: "speaking" });
    });
  });

  describe("agents wave: agent, dock and shortcut questions", () => {
    const URLS = Object.fromEntries(
      ["idle", "listening", "thinking", "talking", "asking", "stop", "happy", "paused"].map((s) => [s, `data:image/svg+xml;base64,${s}`]),
    ) as SessionAgent["avatar"];
    const AGENT: SessionAgent = { id: "a1", name: "Senior Sales Person", role: "Sales", avatar: URLS };

    function make(extra: { agent?: SessionAgent | null; silence?: boolean } = {}) {
      const sent: { kind: string; arg: unknown[] }[] = [];
      const rec = (kind: string) => (...arg: unknown[]) => {
        sent.push({ kind, arg });
        return true;
      };
      const companion: CaptureCompanion = {
        buddyState: rec("state"),
        buddySay: rec("say"),
        buddyPoint: rec("point"),
        buddyClear: rec("clear"),
        sessionState: rec("session"),
        dockShow: rec("dock.show"),
        dockHide: rec("dock.hide"),
        dockLearned: rec("dock.learned"),
      };
      const now = () => Date.now();
      const bus = createEventBus({ now: () => now() / 1000 });
      const voice = { promptTurn: vi.fn(), injectContext: vi.fn(), noteUserActivity: vi.fn(), setMuted: vi.fn(), isSpeaking: vi.fn(() => false) };
      const api = {
        postEvents: vi.fn(async () => ({})),
        postTranscript: vi.fn(async () => ({})),
        postQA: vi.fn(async () => ({})),
        setOffRecord: vi.fn(async () => ({})),
        decide: vi.fn(async () => judgment()),
      };
      const c = createCaptureController({
        api,
        voice: voice as unknown as CaptureVoice,
        bus,
        activity: createActivityTracker({ now }),
        gate: createAskGate({ now, minGapMs: 0 }),
        now,
        sessionId: "s",
        getT: () => now() / 1000,
        companion,
        session: { expert: "Sabine" },
        agent: extra.agent === undefined ? AGENT : extra.agent,
      });
      return { c, bus, sent, voice, api, kinds: () => sent.map((m) => m.kind) };
    }

    it("session.state carries the agent with eight avatar data URLs; dock.show on start, dock.hide on end", () => {
      const { c, sent, kinds } = make();
      c.start();
      expect(kinds()).toContain("dock.show");
      expect(sent.find((m) => m.kind === "dock.show")!.arg).toEqual(["right"]);
      const st = sent.find((m) => m.kind === "session")!.arg[0] as { agent: SessionAgent };
      expect(Object.keys(st.agent.avatar)).toHaveLength(8);
      expect(st.agent).toEqual(AGENT);
      c.stop();
      expect(kinds()[kinds().length - 1]).not.toBe("dock.show");
      expect(kinds().filter((k) => k === "dock.hide")).toHaveLength(1);
    });

    it("without an agent session.state has no agent block (old path)", () => {
      const { c, sent } = make({ agent: null });
      c.start();
      expect(sent.find((m) => m.kind === "session")!.arg[0]).not.toHaveProperty("agent");
    });

    it("dock.learned: shortcut on use, step and guardrail on answers, deduped, nothing off the record", async () => {
      const { c, bus, sent } = make();
      c.start();
      const ev = bus.publishOs({ type: "field_changed", entity: { kind: "invoice", id: "4471" }, field: "cost_center", from: "4711", to: "0400" })!;
      await vi.advanceTimersByTimeAsync(2500);
      c.onTranscript("expert", "It is capex.");
      expect(ev.id).toBeTruthy();
      c.onCompanionChord({ t: 1, chord: "Cmd+Enter", app: "Outlook" });
      await vi.advanceTimersByTimeAsync(2500);
      c.onCompanionChord({ t: 2, chord: "Cmd+Enter", app: "Outlook" });
      await vi.advanceTimersByTimeAsync(2500);
      c.setOffRecord(true);
      c.onCompanionChord({ t: 3, chord: "Cmd+K", app: "Outlook" });
      await vi.advanceTimersByTimeAsync(2500);
      const learned = sent.filter((m) => m.kind === "dock.learned").map((m) => m.arg);
      expect(learned).toEqual([
        ["step", "invoice 4471: It is capex."],
        ["shortcut", "Cmd+Enter in Outlook"],
      ]);
    });

    it("asks about a repeated shortcut at a pause with the shortcut question; at most one live per 3 minutes", async () => {
      const { c, voice, sent } = make();
      c.start();
      const press = async (chord: string) => {
        c.onCompanionChord({ t: 0, chord, app: "Outlook" });
        await vi.advanceTimersByTimeAsync(2600);
      };
      for (let i = 0; i < 3; i++) await press("Cmd+Shift+M");
      expect(voice.promptTurn).toHaveBeenCalledTimes(1);
      expect(voice.promptTurn.mock.calls[0][1]).toMatchObject({ ask: "shortcut" });
      expect(c.lastQuestion()).toBe("You pressed Cmd+Shift+M in Outlook there. What does it do for you and why that way?");
      c.onTranscript("expert", "It moves the mail to the done folder.");
      for (let i = 0; i < 3; i++) await press("Cmd+Shift+J");
      expect(voice.promptTurn).toHaveBeenCalledTimes(1);
      expect(c.debrief().map((d) => d.why)).toContain("shortcut_cap");
      expect(sent.filter((m) => m.kind === "dock.learned").map((m) => m.arg[1])).toContain("Cmd+Shift+M: It moves the mail to the done folder.");
    });
  });
});
