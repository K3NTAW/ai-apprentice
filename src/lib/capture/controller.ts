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
import { COMPANION_STALE_MS, type AskGate, type CompanionActivity } from "@/lib/voice/askGate";
import { redactScreenEvent } from "@/lib/perception/redactEvent";
import type { CompanionClient } from "@/lib/companion/client";
import { buddyStateFor } from "@/lib/companion/buddyState";
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
  /** Desktop companion buddy and panel (protocol v2); every sender is a no-op while not paired. */
  companion?: CaptureCompanion | null;
  /** What the companion panel shows about this session. */
  session?: { expert: string; title?: string; appUrl?: string };
};

export type CaptureCompanion = Pick<CompanionClient, "buddyState" | "buddySay" | "buddyPoint" | "buddyClear" | "sessionState">;
/** Voice agent status and mode (useVoiceAgent); null in text mode. */
export type AgentPresence = { status: string | null; mode: string | null };

type Pending = { event: ScreenEvent; decisions: Decisions; since: number };

/** Activity and app messages from the desktop companion (counts only, see src/lib/companion/client.ts). */
export type CompanionActivityIn = { typing: boolean; pointer: boolean; idle_ms: number };
export type CompanionAppIn = { app: string; title: string };

/** Paid calls the capture loop makes that can hit the workspace daily cap. */
export type LimitedKind = "vision" | "decide";

/** A 429 daily_limit from /api/vision or /api/decide (the http adapter throws "<url> 429"). */
export function isDailyLimitError(err: unknown): boolean {
  if (typeof err === "object" && err !== null && (err as { status?: unknown }).status === 429) return true;
  const message = err instanceof Error ? err.message : String(err);
  return /\b429$/.test(message) || message.includes("daily_limit");
}

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
  const buddy = opts.companion ?? null;
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
  // Last companion activity with its local receive time; null when absent or disconnected.
  let companion: { typing: boolean; idle_ms: number; at: number } | null = null;
  let unsubscribe: (() => void) | null = null;
  // Once a kind hits its daily cap, the loop stops calling it for this session.
  const limited = new Set<LimitedKind>();
  let running = false;
  let talking = false;
  let agent: AgentPresence = { status: null, mode: null };
  let lastAnswer = "";
  let sentBuddy: string | null = null;
  let sentSession: string | null = null;

  /** Sends buddy.state and session.state when they changed. Off the record only these two go out. */
  function syncCompanion() {
    if (!buddy) return;
    const state = buddyStateFor({
      active: running,
      paused: offRecord,
      voiceStatus: agent.status,
      mode: agent.mode,
      pending: deciding,
      talking,
    });
    if (state !== sentBuddy) {
      sentBuddy = state;
      buddy.buddyState(state);
    }
    const g = gate.stats();
    const expert = opts.session?.expert ?? "";
    const session = {
      mode: running ? ("capture" as const) : null,
      title: opts.session?.title ?? (expert ? `Capture: ${expert}` : "Capture"),
      expert,
      asked: g.asked,
      guardrails: g.guardrailAsked,
      last_question: lastQuestion ?? "",
      last_answer: lastAnswer,
      off_record: offRecord,
      app_url: opts.session?.appUrl ?? "",
    };
    const key = JSON.stringify(session);
    if (key !== sentSession) {
      sentSession = key;
      buddy.sessionState(session);
    }
  }

  const changed = () => {
    syncCompanion();
    onChange?.();
  };
  const hitLimit = (kind: LimitedKind) => {
    limited.add(kind);
    changed();
  };
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

  /** Companion block for the gate; stale (> COMPANION_STALE_MS) or disconnected counts as absent. */
  function companionBlock(): CompanionActivity | undefined {
    if (!companion) return undefined;
    const fresh = now() - companion.at <= COMPANION_STALE_MS;
    return { typing: companion.typing, idle_ms: companion.idle_ms, fresh };
  }

  function gateActivity() {
    const snap = activity.snapshot();
    const c = companionBlock();
    return {
      typing: snap.typing,
      // Push-to-talk held: the user is talking, so the gate holds questions and the agent listens.
      speaking: snap.speaking || talking,
      silence_ms: snap.silence_ms,
      ...(c ? { companion: c } : {}),
    };
  }

  const companionTyping = () => {
    const c = companionBlock();
    return Boolean(c?.fresh && c.typing);
  };

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
    // Glance at what the question is about; no halo, the expert keeps driving.
    if (event.rect) buddy?.buddyPoint({ id: `glance_${event.id}`, rect: event.rect, style: "glance" });
  }

  /** Runs the gate on one item; true when it is settled (asked, saved or dropped as routine). */
  function evaluate(item: Pending): boolean {
    const d = gate.consider({
      event: item.event,
      eventClass: item.decisions.event_class,
      screenExplains: item.decisions.screen_explains_it,
      timing: item.decisions.ask_timing,
      activity: gateActivity(),
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
    if (activity.snapshot().typing || companionTyping()) pingActivity();
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
    if (limited.has("decide")) {
      debrief.push({ event, why: "daily_limit" });
      changed();
      return;
    }
    const snap = activity.snapshot();
    const state = {
      event,
      recent_events: seen.slice(-RECENT_EVENTS),
      silence_ms: snap.silence_ms,
      typing: snap.typing || companionTyping(),
      speaking: snap.speaking || voice.isSpeaking(),
      questions_asked_last_10min: gate.stats().askedLast10Min,
    };
    deciding++;
    changed();
    let decisions: Partial<Decisions>;
    try {
      decisions = await api.decide(QUESTIONS, state);
    } catch (err) {
      if (isDailyLimitError(err)) {
        hitLimit("decide");
        debrief.push({ event, why: "daily_limit" });
        return;
      }
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
      // Nothing companion-derived survives into the off-record range.
      companion = null;
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
      buddy?.buddySay(text);
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
    if (open) {
      lastAnswer = text;
      closeOpen(text);
    }
    changed();
  }

  /** Companion activity: holds questions while typing, idle_ms feeds the pause. Dropped off the record. */
  function onCompanionActivity(a: CompanionActivityIn) {
    if (offRecord) return;
    companion = { typing: a.typing, idle_ms: a.idle_ms, at: now() };
    if (a.typing) pingActivity();
  }

  /** Frontmost app or window change: stored as an os app_switched, redacted first. Dropped off the record. */
  function onCompanionApp(a: CompanionAppIn) {
    if (offRecord) return;
    const app = a.app.trim();
    if (!app) return;
    const clean = redactScreenEvent({ app, window: a.title.trim() || undefined });
    if (!clean.window) delete clean.window;
    bus.publishOs({ type: "app_switched", entity: { kind: "app", id: clean.app ?? app }, ...clean });
  }

  /** The socket closed: companion activity counts as absent until the next message. */
  function onCompanionDisconnected() {
    companion = null;
  }

  async function onFrame(frame: FrameIn) {
    if (offRecord || !api.postFrame || limited.has("vision")) return;
    try {
      const res = await api.postFrame(frame);
      if (!offRecord && res.events.length) bus.publishVision(res.events, frame.t, res.frame_ref);
    } catch (err) {
      if (isDailyLimitError(err)) hitLimit("vision");
      else fail("postFrame")(err);
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
      running = true;
      unsubscribe = bus.subscribe((ev) => {
        void onEvent(ev);
      });
      timer = setInterval(tick, TICK_MS);
      changed();
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
      running = false;
      talking = false;
      changed();
    },
    tick,
    onTranscript,
    onFrame,
    onCompanionActivity,
    onCompanionApp,
    onCompanionDisconnected,
    setOffRecord,
    /** Voice agent status and mode, for the buddy state. */
    setAgent(next: AgentPresence) {
      if (next.status === agent.status && next.mode === agent.mode) return;
      agent = { ...next };
      changed();
    },
    /** Push-to-talk from the companion: while held the gate holds and the agent hears the user. */
    setTalking(held: boolean) {
      if (held === talking) return;
      talking = held;
      if (held && !offRecord) voice.noteUserActivity();
      changed();
    },
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
    /** Kinds refused with 429 daily_limit in this session. */
    dailyLimit: (): LimitedKind[] => [...limited],
    stats,
  };
}

export type CaptureController = ReturnType<typeof createCaptureController>;
