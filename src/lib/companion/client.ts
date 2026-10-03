// Browser client for the desktop companion (COMPANION PROTOCOL, pivot wave): ws://127.0.0.1:47321,
// hello with the 6-digit pairing code, status/activity/app in, overlay.halo/overlay.clear out.
// Works without the companion: status stays "not connected" and nothing throws.
// The pairing code is never logged.

export const COMPANION_URL = "ws://127.0.0.1:47321";
export const CODE_KEY = "ai-apprentice.companion.code";
export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 30000;
export const HALO_TEXT_MAX = 140;
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
export type CompanionMessage = CompanionStatusMsg | CompanionActivityMsg | CompanionAppMsg | { type: "pong" };
export type HaloRect = { x: number; y: number; w: number; h: number };

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

type Listeners = {
  status: (s: CompanionStatus, permissions: CompanionPermissions | null) => void;
  activity: (a: CompanionActivityMsg) => void;
  app: (a: CompanionAppMsg) => void;
};

const OPEN = 1;
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isCount = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0;
const clamp01 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

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
  const listeners: { [K in keyof Listeners]: Set<Listeners[K]> } = {
    status: new Set(),
    activity: new Set(),
    app: new Set(),
  };
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
      status = "paired";
      for (const fn of listeners.status) fn(status, permissions);
    } else if (msg.type === "activity") {
      if (status === "paired") for (const fn of listeners.activity) fn(msg);
    } else if (msg.type === "app") {
      if (status === "paired") for (const fn of listeners.app) fn(msg);
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
    on<K extends keyof Listeners>(kind: K, fn: Listeners[K]): () => void {
      listeners[kind].add(fn);
      return () => {
        listeners[kind].delete(fn);
      };
    },
    /** Draws a halo over any app. No-op returning false while not paired. */
    showHalo(id: string, rect: HaloRect, text?: string): boolean {
      const r = { x: clamp01(rect.x), y: clamp01(rect.y), w: clamp01(rect.w), h: clamp01(rect.h) };
      const msg: Record<string, unknown> = { type: "overlay.halo", id: String(id), rect: r };
      if (typeof text === "string" && text) msg.text = text.slice(0, HALO_TEXT_MAX);
      return send(msg);
    },
    clearHalo(id?: string): boolean {
      return send(id === undefined ? { type: "overlay.clear" } : { type: "overlay.clear", id: String(id) });
    },
    dispose() {
      disposed = true;
      clearTimer();
      drop();
      setStatus("not connected");
    },
  };
}

export type CompanionClient = ReturnType<typeof createCompanionClient>;
