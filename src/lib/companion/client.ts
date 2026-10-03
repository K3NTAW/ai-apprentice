// Browser client for the desktop companion (COMPANION PROTOCOL, pivot wave): ws://127.0.0.1:47321,
// hello with the 6-digit pairing code, status/activity/app/shortcut in, overlay.* and (protocol v2)
// buddy.state/buddy.say/buddy.point/buddy.clear/session.state out; protocol v3: chord in, dock.* out and
// session.state.agent.
// Works without the companion: status stays "not connected" and nothing throws.
// The pairing code is never logged.

import { CHORD_APP_MAX, isAllowedChord } from "./chord";
import { validSessionAgent, type SessionAgent } from "./agentState";

export const COMPANION_URL = "ws://127.0.0.1:47321";
export const CODE_KEY = "ai-apprentice.companion.code";
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30000;
export const HALO_TEXT_MAX = 140;
export const SAY_TEXT_MAX = 280;
const MAX_APP = 200;
const MAX_TITLE = 500;

export type CompanionStatus = "not connected" | "connecting" | "pair" | "paired" | "origin blocked";
export type CompanionPermissions = { input: boolean; screen: boolean; accessibility: boolean };
export type CompanionStatusMsg = { type: "status"; version: string; permissions: CompanionPermissions };
export type CompanionActivityMsg = {
  type: "activity";
  t: number;
  typing: boolean;
  pointer: boolean;
  keys: number;
  clicks: number;
  idle_ms: number;
};
export type CompanionAppMsg = { type: "app"; t: number; app: string; title: string };
export const SHORTCUT_ACTIONS = ["talk_start", "talk_end", "off_record_toggle", "pause_toggle", "end_task"] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
export type CompanionShortcutMsg = { type: "shortcut"; action: ShortcutAction };
export type CompanionChordMsg = { type: "chord"; t: number; chord: string; app: string };
export type DockSide = "right" | "left";
export type DockLearnedKind = "step" | "shortcut" | "guardrail";
export const DOCK_TEXT_MAX = 140;
export type CompanionMessage =
  | CompanionStatusMsg
  | CompanionActivityMsg
  | CompanionAppMsg
  | CompanionShortcutMsg
  | CompanionChordMsg
  | { type: "pong" };
export type HaloRect = { x: number; y: number; w: number; h: number };
export type BuddyState = "idle" | "listening" | "thinking" | "speaking" | "paused";
export type PointStyle = "glance" | "stop";
export type BuddyPoint = { id: string; rect: HaloRect; style: PointStyle; text?: string; ttl_ms?: number };
export type SessionState = {
  mode: "capture" | "teach" | null;
  title: string;
  expert: string;
  asked: number;
  guardrails: number;
  last_question: string;
  last_answer: string;
  off_record: boolean;
  app_url: string;
  /** Protocol v3, optional: the session's agent and its eight avatar data URLs. Omitted when invalid. */
  agent?: SessionAgent;
};

/** The subset of WebSocket the client uses, so tests can inject a fake. */
export type SocketLike = {
  readyState: number;
  send(data: string): void;
  close(code?: number): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
};

export type KeyValueStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export type CompanionClientOptions = {
  url?: string;
  createSocket?: (url: string) => SocketLike;
  storage?: KeyValueStore | null;
  random?: () => number;
};

export type CompanionListeners = {
  status: (s: CompanionStatus, permissions: CompanionPermissions | null) => void;
  activity: (a: CompanionActivityMsg) => void;
  app: (a: CompanionAppMsg) => void;
  shortcut: (action: ShortcutAction) => void;
  chord: (c: CompanionChordMsg) => void;
};

const OPEN = 1;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const clamp01 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);
const clampRect = (r: HaloRect): HaloRect => ({ x: clamp01(r.x), y: clamp01(r.y), w: clamp01(r.w), h: clamp01(r.h) });
const ttl = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : undefined);
const count = (v: number) => (Number.isFinite(v) && v > 0 ? Math.floor(v) : 0);

/** Web -> companion message shapes, shared by the WebSocket client and the bridge transport (transport.ts). */
export const outgoing = {
  halo(id: string, rect: HaloRect, text?: string): Record<string, unknown> {
    const msg: Record<string, unknown> = { type: "overlay.halo", id: String(id), rect: clampRect(rect) };
    if (typeof text === "string" && text) msg.text = text.slice(0, HALO_TEXT_MAX);
    return msg;
  },
  clearHalo: (id?: string) => (id === undefined ? { type: "overlay.clear" } : { type: "overlay.clear", id: String(id) }),
  buddyState: (state: BuddyState) => ({ type: "buddy.state", state }),
  /** Null when the text is empty. */
  buddySay(text: string, ttlMs?: number): Record<string, unknown> | null {
    const t = String(text ?? "").trim().slice(0, SAY_TEXT_MAX);
    if (!t) return null;
    const ms = ttl(ttlMs);
    return ms === undefined ? { type: "buddy.say", text: t } : { type: "buddy.say", text: t, ttl_ms: ms };
  },
  buddyPoint(p: BuddyPoint): Record<string, unknown> {
    const msg: Record<string, unknown> = { type: "buddy.point", id: String(p.id), rect: clampRect(p.rect), style: p.style };
    if (typeof p.text === "string" && p.text) msg.text = p.text.slice(0, HALO_TEXT_MAX);
    const ms = ttl(p.ttl_ms);
    if (ms !== undefined) msg.ttl_ms = ms;
    return msg;
  },
  buddyClear: (id?: string) => (id === undefined ? { type: "buddy.clear" } : { type: "buddy.clear", id: String(id) }),
  /** The normalised session.state fields (without "type"). */
  sessionState(s: SessionState): SessionState {
    return {
      mode: s.mode,
      title: String(s.title ?? ""),
      expert: String(s.expert ?? ""),
      asked: count(s.asked),
      guardrails: count(s.guardrails),
      last_question: String(s.last_question ?? "").slice(0, SAY_TEXT_MAX),
      last_answer: String(s.last_answer ?? "").slice(0, SAY_TEXT_MAX),
      off_record: Boolean(s.off_record),
      app_url: String(s.app_url ?? ""),
      ...(validSessionAgent(s.agent) ? { agent: s.agent } : {}),
    };
  },
  dockSide: (side: DockSide = "right"): DockSide => (side === "left" ? "left" : "right"),
  /** Null when the text is empty or the kind unknown. */
  dockLearned(kind: DockLearnedKind, text: string): Record<string, unknown> | null {
    const t = String(text ?? "").trim().slice(0, DOCK_TEXT_MAX);
    if (!t || !["step", "shortcut", "guardrail"].includes(kind)) return null;
    return { type: "dock.learned", kind, text: t };
  },
};

/** Validates one incoming frame; malformed frames return null and are ignored. */
export function parseCompanionMessage(raw: unknown): CompanionMessage | null {
  if (typeof raw !== "string" || raw.length > 10000) return null;
  let m: Record<string, unknown>;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) return null;
    m = v as Record<string, unknown>;
  } catch {
    return null;
  }
  switch (m.type) {
    case "status": {
      const p = m.permissions as Record<string, unknown> | null;
      if (typeof m.version !== "string" || !p || typeof p !== "object") return null;
      if (!isBool(p.input) || !isBool(p.screen) || !isBool(p.accessibility)) return null;
      return {
        type: "status",
        version: m.version.slice(0, 32),
        permissions: { input: p.input, screen: p.screen, accessibility: p.accessibility },
      };
    }
    case "activity":
      if (!isCount(m.t) || !isBool(m.typing) || !isBool(m.pointer)) return null;
      if (!isCount(m.keys) || !isCount(m.clicks) || !isCount(m.idle_ms)) return null;
      return {
        type: "activity",
        t: m.t,
        typing: m.typing,
        pointer: m.pointer,
        keys: Math.floor(m.keys),
        clicks: Math.floor(m.clicks),
        idle_ms: m.idle_ms,
      };
    case "app":
      if (!isCount(m.t) || typeof m.app !== "string" || !m.app.trim() || typeof m.title !== "string") return null;
      return { type: "app", t: m.t, app: m.app.slice(0, MAX_APP), title: m.title.slice(0, MAX_TITLE) };
    case "shortcut":
      if (!(SHORTCUT_ACTIONS as readonly unknown[]).includes(m.action)) return null;
      return { type: "shortcut", action: m.action as ShortcutAction };
    case "chord":
      // Defensive: the companion never sends plain typing; drop anything that looks like it.
      if (!isCount(m.t) || !isAllowedChord(m.chord) || typeof m.app !== "string") return null;
      return { type: "chord", t: m.t, chord: m.chord, app: m.app.trim().slice(0, CHORD_APP_MAX) };
    case "pong":
      return { type: "pong" };
    default:
      return null;
  }
}

function defaultStorage(): KeyValueStore | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

export function createCompanionClient({
  url = COMPANION_URL,
  createSocket,
  storage = defaultStorage(),
  random = Math.random,
}: CompanionClientOptions = {}) {
  const make =
    createSocket ??
    ((u: string) => {
      if (typeof WebSocket === "undefined") throw new Error("no WebSocket");
      return new WebSocket(u) as unknown as SocketLike;
    });
  const listeners: { [K in keyof CompanionListeners]: Set<CompanionListeners[K]> } = {
    status: new Set(),
    activity: new Set(),
    app: new Set(),
    shortcut: new Set(),
    chord: new Set(),
  };
  // Last buddy and session state, resent when pairing completes.
  let lastBuddy: BuddyState | null = null;
  let lastSession: SessionState | null = null;
  let lastDock: DockSide | null = null;
  let socket: SocketLike | null = null;
  let status: CompanionStatus = "not connected";
  let permissions: CompanionPermissions | null = null;
  let version: string | null = null;
  let attempt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const read = (): string | null => {
    try {
      return storage?.getItem(CODE_KEY) ?? null;
    } catch {
      return null;
    }
  };
  const write = (code: string | null) => {
    try {
      if (code) storage?.setItem(CODE_KEY, code);
      else storage?.removeItem(CODE_KEY);
    } catch {
      // storage blocked: the code lives for this page only
    }
  };
  let code: string | null = read();

  function setStatus(next: CompanionStatus) {
    if (next !== "paired") permissions = null;
    if (next === status && next !== "paired") return;
    status = next;
    for (const fn of listeners.status) fn(status, permissions);
  }

  function clearTimer() {
    if (timer !== null) clearTimeout(timer);
    timer = null;
  }

  function drop() {
    const s = socket;
    socket = null;
    if (!s) return;
    s.onopen = s.onmessage = s.onclose = s.onerror = null;
    try {
      s.close();
    } catch {
      // already closed
    }
  }

  /** Capped exponential backoff with jitter (50..100% of the step). */
  function backoffMs(n: number): number {
    const step = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** n);
    return Math.round(step * (0.5 + 0.5 * random()));
  }

  function scheduleReconnect() {
    if (disposed || timer !== null || !code) return;
    const delay = backoffMs(attempt);
    attempt++;
    timer = setTimeout(() => {
      timer = null;
      open();
    }, delay);
  }

  function onMessage(raw: unknown) {
    const msg = parseCompanionMessage(raw);
    if (!msg) return;
    if (msg.type === "status") {
      version = msg.version;
      permissions = msg.permissions;
      const wasPaired = status === "paired";
      status = "paired";
      if (!wasPaired) {
        if (lastBuddy) send({ type: "buddy.state", state: lastBuddy });
        if (lastSession) send({ type: "session.state", ...lastSession });
        if (lastDock) send({ type: "dock.show", side: lastDock });
      }
      for (const fn of listeners.status) fn(status, permissions);
    } else if (msg.type === "activity") {
      if (status === "paired") for (const fn of listeners.activity) fn(msg);
    } else if (msg.type === "app") {
      if (status === "paired") for (const fn of listeners.app) fn(msg);
    } else if (msg.type === "shortcut") {
      if (status === "paired") for (const fn of listeners.shortcut) fn(msg.action);
    } else if (msg.type === "chord") {
      if (status === "paired") for (const fn of listeners.chord) fn(msg);
    }
  }

  function open() {
    if (disposed || socket) return;
    if (!code) {
      setStatus("pair");
      return;
    }
    let s: SocketLike;
    try {
      s = make(url);
    } catch {
      setStatus("not connected");
      scheduleReconnect();
      return;
    }
    socket = s;
    setStatus("connecting");
    s.onopen = () => {
      attempt = 0;
      try {
        s.send(JSON.stringify({ type: "hello", token: code }));
      } catch {
        // close follows
      }
    };
    s.onmessage = (ev) => onMessage(ev.data);
    s.onerror = () => {
      // a close event always follows
    };
    s.onclose = (ev) => {
      if (socket !== s) return;
      socket = null;
      version = null;
      if (ev.code === 4401) {
        code = null;
        write(null);
        setStatus("pair");
      } else if (ev.code === 4403) {
        setStatus("origin blocked");
      } else {
        setStatus("not connected");
        scheduleReconnect();
      }
    };
  }

  function send(msg: object): boolean {
    if (!socket || socket.readyState !== OPEN || status !== "paired") return false;
    try {
      socket.send(JSON.stringify(msg));
      return true;
    } catch {
      return false;
    }
  }

  return {
    /** Connects with the stored code; status "pair" when there is none. */
    connect() {
      disposed = false;
      open();
    },
    /** Stores a new pairing code (6 digits) and reconnects with it. False when the code is malformed. */
    pair(next: string): boolean {
      const c = next.trim();
      if (!/^\d{6}$/.test(c)) return false;
      code = c;
      write(c);
      clearTimer();
      attempt = 0;
      drop();
      disposed = false;
      open();
      return true;
    },
    status: () => status,
    permissions: () => permissions,
    version: () => version,
    hasCode: () => code !== null,
    isPaired: () => status === "paired",
    on<K extends keyof CompanionListeners>(kind: K, fn: CompanionListeners[K]): () => void {
      listeners[kind].add(fn);
      return () => {
        listeners[kind].delete(fn);
      };
    },
    /** Draws a halo over any app. No-op returning false while not paired. */
    showHalo(id: string, rect: HaloRect, text?: string): boolean {
      return send(outgoing.halo(id, rect, text));
    },
    clearHalo(id?: string): boolean {
      return send(outgoing.clearHalo(id));
    },
    /** Buddy presence. Remembered and resent on pairing; false while not paired. */
    buddyState(state: BuddyState): boolean {
      lastBuddy = state;
      return send(outgoing.buddyState(state));
    },
    /** Caption next to the buddy (agent lines only), clipped to 280 chars. */
    buddySay(text: string, ttlMs?: number): boolean {
      const msg = outgoing.buddySay(text, ttlMs);
      return msg ? send(msg) : false;
    },
    /** 'glance' flies to the rect briefly; 'stop' stays with halo and bubble until buddyClear. */
    buddyPoint(p: BuddyPoint): boolean {
      return send(outgoing.buddyPoint(p));
    },
    buddyClear(id?: string): boolean {
      return send(outgoing.buddyClear(id));
    },
    /** Session summary for the companion panel. Remembered and resent on pairing. */
    sessionState(s: SessionState): boolean {
      lastSession = outgoing.sessionState(s);
      return send({ type: "session.state", ...lastSession });
    },
    /** Docks the agent at the side of the screen. Remembered and resent on pairing until dockHide. */
    dockShow(side: DockSide = "right"): boolean {
      lastDock = outgoing.dockSide(side);
      return send({ type: "dock.show", side: lastDock });
    },
    dockHide(): boolean {
      lastDock = null;
      return send({ type: "dock.hide" });
    },
    /** One line in the dock's 'What I learned' feed, clipped to 140 chars. Not resent. */
    dockLearned(kind: DockLearnedKind, text: string): boolean {
      const msg = outgoing.dockLearned(kind, text);
      return msg ? send(msg) : false;
    },
    dispose() {
      // Clean-up: the dock goes away with the page.
      if (lastDock) {
        lastDock = null;
        send({ type: "dock.hide" });
      }
      disposed = true;
      clearTimer();
      drop();
      setStatus("not connected");
    },
  };
}

export type CompanionClient = ReturnType<typeof createCompanionClient>;
