// Capture loop (docs/BUILD_SPEC.md Module 1, D2, D7): bus events -> decide -> ask gate -> voice.
// Framework free; every I/O is injected so the loop is unit-testable with fake timers.
import {
  newId,
  type DecisionQuestionName,
  type DecisionResult,
  type QAPair,
  type ScreenEvent,
  type TranscriptEntry,
  type VisionEvent,
} from "@/lib/types";
import type { EventBus } from "@/lib/perception/eventBus";
import type { ActivityTracker } from "@/lib/perception/activity";
import type { AskGate } from "@/lib/voice/askGate";
import { buildScreenEventTurn, describeEvent, describeObject, type AskKind } from "@/lib/voice/prompts";

export const TICK_MS = 500;
export const MAX_WAIT_MS = 20000;
export const ACTIVITY_THROTTLE_MS = 1000;
export const RECENT_EVENTS = 8;
export const FEED_SIZE = 6;

const QUESTIONS: DecisionQuestionName[] = ["event_class", "screen_explains_it", "ask_timing"];
const OFF_RE = /\boff the record\b/i;
const ON_RE = /\b(back on the record|on the record again)\b/i;

export type Decisions = Record<DecisionQuestionName, DecisionResult>;
export type FrameIn = { jpegBase64: string; t: number };

export type CaptureApi = {
  postEvents(events: ScreenEvent[]): Promise<unknown>;
  postTranscript(entries: TranscriptEntry[]): Promise<unknown>;
  postQA(qa: QAPair): Promise<unknown>;
  decide(questions: DecisionQuestionName[], state: unknown): Promise<Partial<Decisions>>;
  setOffRecord(range: { from: number; to?: number }): Promise<unknown>;
  postFrame?(frame: FrameIn): Promise<{ events: VisionEvent[]; frame_ref?: string }>;
};

export type CaptureVoice = {
  /** `meta` lets a text-mode adapter phrase the question itself. */
  promptTurn(text: string, meta: { event: ScreenEvent; ask: AskKind }): void;
  injectContext(text: string): void;
  noteUserActivity(): void;
  setMuted(muted: boolean): void;
  isSpeaking(): boolean;
};

export type FrameCapture = { pause(): void; resume(): void };

export type DebriefItem = { event: ScreenEvent; why: string };

export type CaptureControllerOptions = {
  api: CaptureApi;
  voice: CaptureVoice;
  bus: EventBus;
  activity: ActivityTracker;
  gate: AskGate;
  /** Wall clock in ms, for timers and throttles. */
  now: () => number;
  sessionId: string;
  /** Session time in seconds, stamped on transcript, QA and off-record ranges. */
  getT: () => number;
  onChange?: () => void;
  onError?: (where: string, err: unknown) => void;
};

type Pending = { event: ScreenEvent; decisions: Decisions; since: number };

/** Plain question for text mode, and the placeholder until the voice agent phrases its own. */
export function fallbackQuestion(event: ScreenEvent, ask: AskKind): string {
  const obj = describeObject(event);
  const field = event.field ? `, ${event.field.replace(/[_-]+/g, " ")}` : "";
  return ask === "guardrail"
    ? `Is there a limit on ${obj}${field}, or when would you stop and ask someone?`
    : `Why this step on ${obj}${field}?`;
}

export function createCaptureController(opts: CaptureControllerOptions) {
  const { api, voice, bus, activity, gate, now, getT, onChange, onError } = opts;
  const seen: ScreenEvent[] = [];
  let pending: Pending[] = [];
  const debrief: DebriefItem[] = [];
  let open: { qa: QAPair; filled: boolean } | null = null;
  let lastQuestion: string | null = null;
  let offRecord = false;
  let offFrom = 0;
  let deciding = 0;
  let lastActivityPing = -Infinity;
  let capture: FrameCapture | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let unsubscribe: (() => void) | null = null;

  const changed = () => onChange?.();
  const fail = (where: string) => (err: unknown) => onError?.(where, err);
  // Posts never throw into the loop; failures go to onError.
  const send = (where: string, p: () => Promise<unknown>) => {
    try {
      p().catch(fail(where));
    } catch (err) {
      fail(where)(err);
    }
  };

  function pingActivity() {
    const t = now();
    if (t - lastActivityPing < ACTIVITY_THROTTLE_MS) return;
    lastActivityPing = t;
    voice.noteUserActivity();
  }

  function ask(event: ScreenEvent, kind: AskKind) {
    gate.markAsked(kind);
    if (open) closeOpen();
    const question = fallbackQuestion(event, kind);
    open = {
      qa: {
        id: newId("qa"),
        t_question: getT(),
        question,
        event_id: event.id,
        ...(event.frame_ref ? { frame_ref: event.frame_ref } : {}),
        phase: "capture",
        about: kind,
      },
      filled: false,
    };
    lastQuestion = question;
    voice.promptTurn(buildScreenEventTurn(event, kind), { event, ask: kind });
  }

  /** Runs the gate on one item; true when it is settled (asked, saved or dropped as routine). */
  function evaluate(item: Pending): boolean {
    const snap = activity.snapshot();
    const d = gate.consider({
      event: item.event,
      eventClass: item.decisions.event_class,
      screenExplains: item.decisions.screen_explains_it,
      timing: item.decisions.ask_timing,
      activity: { typing: snap.typing, speaking: snap.speaking, silence_ms: snap.silence_ms },
      agentSpeaking: voice.isSpeaking(),
    });
    if (d.action === "ask_now") {
      ask(item.event, d.ask ?? "reason");
      return true;
    }
    if (d.action === "save_for_debrief") {
      debrief.push({ event: item.event, why: d.why });
      return true;
    }
    if (d.why === "routine") return true;
    if (now() - item.since >= MAX_WAIT_MS) {
      debrief.push({ event: item.event, why: "waited_too_long" });
      return true;
    }
    return false;
  }

  function tick() {
    if (offRecord) return;
    if (activity.snapshot().typing) pingActivity();
    if (!pending.length) return;
    const keep: Pending[] = [];
    let askedThisTick = false;
    for (const item of pending) {
      // At most one question per tick; the rest are looked at again on the next one.
      if (askedThisTick) {
        keep.push(item);
        continue;
      }
      const before = gate.stats().asked;
      if (!evaluate(item)) keep.push(item);
      else if (gate.stats().asked > before) askedThisTick = true;
    }
    pending = keep;
    changed();
  }

  async function onEvent(event: ScreenEvent) {
    if (offRecord) return;
    seen.push(event);
    send("postEvents", () => api.postEvents([event]));
    voice.injectContext(describeEvent(event));
    const snap = activity.snapshot();
    const state = {
      event,
      recent_events: seen.slice(-RECENT_EVENTS),
      silence_ms: snap.silence_ms,
      typing: snap.typing,
      speaking: snap.speaking || voice.isSpeaking(),
      questions_asked_last_10min: gate.stats().askedLast10Min,
    };
    deciding++;
    changed();
    let decisions: Partial<Decisions>;
    try {
      decisions = await api.decide(QUESTIONS, state);
    } catch (err) {
      fail("decide")(err);
      debrief.push({ event, why: "decide_failed" });
      return;
    } finally {
      deciding--;
      changed();
    }
    if (!decisions?.event_class || !decisions.screen_explains_it || !decisions.ask_timing) {
      debrief.push({ event, why: "decide_incomplete" });
      changed();
      return;
    }
    const item: Pending = { event, decisions: decisions as Decisions, since: now() };
    if (offRecord || !evaluate(item)) pending.push(item);
    changed();
  }

  function closeOpen(answer?: string) {
    if (!open) return;
    const qa: QAPair = answer === undefined ? open.qa : { ...open.qa, answer, t_answer: getT() };
    open = null;
    send("postQA", () => api.postQA(qa));
  }

  function postEntry(speaker: TranscriptEntry["speaker"], text: string) {
    const entry: TranscriptEntry = { id: newId("tr"), t: getT(), speaker, text, phase: "capture", redacted: false };
    send("postTranscript", () => api.postTranscript([entry]));
  }

  function setOffRecord(active: boolean) {
    if (active === offRecord) return;
    offRecord = active;
    bus.setPaused(active);
    voice.setMuted(active);
    if (active) {
      capture?.pause();
      offFrom = getT();
      send("setOffRecord", () => api.setOffRecord({ from: offFrom }));
    } else {
      send("setOffRecord", () => api.setOffRecord({ from: offFrom, to: Math.max(offFrom, getT()) }));
      capture?.resume();
    }
    changed();
  }

  function onTranscript(speaker: TranscriptEntry["speaker"], raw: string) {
    const text = raw.trim();
    if (!text) return;
    if (speaker === "agent") {
      if (offRecord) return;
      postEntry("agent", text);
      if (open && !open.filled) {
        open.qa.question = text;
        open.filled = true;
        lastQuestion = text;
      }
      changed();
      return;
    }
    // Local phrase check so off the record works even if the agent misses it. Nothing said off the record is kept.
    if (offRecord) {
      if (ON_RE.test(text)) setOffRecord(false);
      return;
    }
    if (OFF_RE.test(text) && !ON_RE.test(text)) {
      setOffRecord(true);
      return;
    }
    activity.noteSpeech(true);
    activity.noteSpeech(false);
    postEntry(speaker, text);
    if (open) closeOpen(text);
    changed();
  }

  async function onFrame(frame: FrameIn) {
    if (offRecord || !api.postFrame) return;
    try {
      const res = await api.postFrame(frame);
      if (!offRecord && res.events.length) bus.publishVision(res.events, frame.t, res.frame_ref);
    } catch (err) {
      fail("postFrame")(err);
    }
  }

  function stats() {
    const g = gate.stats();
    return {
      asked: g.asked,
      guardrailAsked: g.guardrailAsked,
      pending: pending.length,
      debrief: debrief.length,
      deciding,
      offRecord,
    };
  }

  return {
    start() {
      if (timer) return;
      unsubscribe = bus.subscribe((ev) => {
        void onEvent(ev);
      });
      timer = setInterval(tick, TICK_MS);
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
      unsubscribe?.();
      unsubscribe = null;
      if (offRecord) setOffRecord(false);
      for (const p of pending) debrief.push({ event: p.event, why: "task_ended" });
      pending = [];
      closeOpen();
      changed();
    },
    tick,
    onTranscript,
    onFrame,
    setOffRecord,
    setCapture(handle: FrameCapture | null) {
      capture = handle;
      if (handle && offRecord) handle.pause();
    },
    noteKeystroke() {
      activity.noteKeystroke();
      pingActivity();
    },
    notePointer() {
      activity.notePointer();
    },
    isOffRecord: () => offRecord,
    debrief: (): DebriefItem[] => [...debrief],
    feed: (): ScreenEvent[] => seen.slice(-FEED_SIZE).reverse(),
    lastQuestion: () => lastQuestion,
    openQuestion: () => (open ? open.qa.question : null),
    stats,
  };
}

export type CaptureController = ReturnType<typeof createCaptureController>;
