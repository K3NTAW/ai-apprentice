// One companion transport for Capture, Teach and the buddy/dock wiring (one-app wave D2).
// - bridge: window.apprentice from the desktop app's preload (BRIDGE CONTRACT). Selected whenever it exists.
// - websocket: the local companion client (client.ts), opt-in only: localStorage WS_SETTING_KEY = "1" or
//   NEXT_PUBLIC_COMPANION_WS=1 at build time. Default off.
// - none: a plain browser by default; every send returns false, no events.
// Message shapes are the protocol v1-v3 messages (client.ts `outgoing`); incoming payloads go through the same
// parseCompanionMessage validation as WebSocket frames.
// Status: the same CompanionStatus for every kind. The bridge is "connecting" (permissions unknown) from connect()
// until the app's first 'status' event, then "paired"; with no event within BRIDGE_STATUS_TIMEOUT_MS it reports
// "not responding" (paired again when a late event arrives) and "not connected" after dispose; none is always
// "not connected". Callers keep their "status !== 'paired'
// -> onCompanionDisconnected" rule unchanged.
import {
  createCompanionClient,
  outgoing,
  parseCompanionMessage,
  type BuddyPoint,
  type BuddyState,
  type CompanionClient,
  type CompanionListeners,
  type CompanionPermissions,
  type CompanionStatus,
  type DockLearnedKind,
  type DockSide,
  type HaloRect,
  type KeyValueStore,
  type SessionState,
} from "./client";

export type TransportKind = "bridge" | "websocket" | "none";
/** "detecting" until the client-side selection ran (SSR and the first client render). */
export type TransportHost = TransportKind | "detecting";
export type WindowAction = "step-aside" | "restore" | "focus";
export type TransportStatus = { kind: TransportKind; status: CompanionStatus; permissions: CompanionPermissions | null };

export const BRIDGE_EVENTS = ["status", "activity", "app", "chord", "shortcut"] as const;
export type BridgeEvent = (typeof BRIDGE_EVENTS)[number];

/** window.apprentice as the preload exposes it. */
export type ApprenticeBridge = {
  version: string;
  platform: "darwin" | "win32" | "linux";
  on(type: BridgeEvent, handler: (payload: unknown) => void): () => void;
  send(message: object): void;
  window(action: WindowAction): void;
  /** Opens the System Settings pane for one permission (main opens only its fixed URL). Absent on older apps. */
  openPermissionSettings?(kind: PermissionSettingsKind): Promise<unknown>;
};

export type PermissionSettingsKind = "microphone" | "screen" | "accessibility" | "input-monitoring";

export type CompanionTransport = {
  readonly kind: TransportKind;
  connect(): void;
  status(): TransportStatus;
  on<K extends keyof CompanionListeners>(kind: K, fn: CompanionListeners[K]): () => void;
  /** WebSocket pairing; false for bridge and none. */
  pair(code: string): boolean;
  showHalo(id: string, rect: HaloRect, text?: string): boolean;
  clearHalo(id?: string): boolean;
  buddyState(state: BuddyState): boolean;
  buddySay(text: string, ttlMs?: number): boolean;
  buddyPoint(p: BuddyPoint): boolean;
  buddyClear(id?: string): boolean;
  sessionState(s: SessionState): boolean;
  dockShow(side?: DockSide): boolean;
  dockHide(): boolean;
  dockLearned(kind: DockLearnedKind, text: string): boolean;
  /** Protocol v4: live 'Now' line (empty text clears it) and a short acknowledgement chip. */
  dockNow(text: string, app?: string): boolean;
  dockAck(text: string): boolean;
  /** Desktop app window control; false outside the app. */
  window(action: WindowAction): boolean;
  /** Idempotent: calls every unsubscribe once, status becomes "not connected". */
  dispose(): void;
};

export const WS_SETTING_KEY = "ai-apprentice.companion.ws";
export const BRIDGE_STATUS_TIMEOUT_MS = 3000;

/** window.apprentice when it has the contract's shape, else null. */
export function getBridge(win: unknown = typeof window === "undefined" ? undefined : window): ApprenticeBridge | null {
  const b = (win as { apprentice?: unknown } | undefined)?.apprentice as Partial<ApprenticeBridge> | undefined;
  if (!b || typeof b !== "object") return null;
  if (typeof b.on !== "function" || typeof b.send !== "function" || typeof b.window !== "function") return null;
  return b as ApprenticeBridge;
}

export function wsTransportEnabled(
  storage: KeyValueStore | null = defaultStorage(),
  env: string | undefined = process.env.NEXT_PUBLIC_COMPANION_WS,
): boolean {
  if (env === "1") return true;
  try {
    return storage?.getItem(WS_SETTING_KEY) === "1";
  } catch {
    return false;
  }
}

function defaultStorage(): KeyValueStore | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function listenerSets() {
  return {
    status: new Set<CompanionListeners["status"]>(),
    activity: new Set<CompanionListeners["activity"]>(),
    app: new Set<CompanionListeners["app"]>(),
    shortcut: new Set<CompanionListeners["shortcut"]>(),
    chord: new Set<CompanionListeners["chord"]>(),
  };
}

export function createNoneTransport(): CompanionTransport {
  const no = () => false;
  return {
    kind: "none",
    connect() {},
    status: () => ({ kind: "none", status: "not connected", permissions: null }),
    on: () => () => {},
    pair: no,
    showHalo: no,
    clearHalo: no,
    buddyState: no,
    buddySay: no,
    buddyPoint: no,
    buddyClear: no,
    sessionState: no,
    dockShow: no,
    dockHide: no,
    dockLearned: no,
    dockNow: no,
    dockAck: no,
    window: no,
    dispose() {},
  };
}

export function createWebSocketTransport(client: CompanionClient = createCompanionClient()): CompanionTransport {
  let disposed = false;
  return {
    kind: "websocket",
    connect() {
      disposed = false;
      client.connect();
    },
    status: () => ({ kind: "websocket", status: client.status(), permissions: client.permissions() }),
    on: (kind, fn) => client.on(kind, fn),
    pair: (code) => client.pair(code),
    showHalo: (id, rect, text) => client.showHalo(id, rect, text),
    clearHalo: (id) => client.clearHalo(id),
    buddyState: (s) => client.buddyState(s),
    buddySay: (t, ms) => client.buddySay(t, ms),
    buddyPoint: (p) => client.buddyPoint(p),
    buddyClear: (id) => client.buddyClear(id),
    sessionState: (s) => client.sessionState(s),
    dockShow: (side) => client.dockShow(side),
    dockHide: () => client.dockHide(),
    dockLearned: (k, t) => client.dockLearned(k, t),
    dockNow: (t, app) => client.dockNow(t, app),
    dockAck: (t) => client.dockAck(t),
    window: () => false,
    dispose() {
      if (disposed) return;
      disposed = true;
      client.dispose();
    },
  };
}

export function createBridgeTransport(
  bridge: ApprenticeBridge,
  { statusTimeoutMs = BRIDGE_STATUS_TIMEOUT_MS }: { statusTimeoutMs?: number } = {},
): CompanionTransport {
  const listeners = listenerSets();
  let status: CompanionStatus = "not connected";
  let permissions: CompanionPermissions | null = null;
  let offs: (() => void)[] = [];
  let dockShown = false;
  let timer: ReturnType<typeof setTimeout> | null = null;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
  }

  function emitStatus() {
    for (const fn of listeners.status) fn(status, permissions);
  }

  function send(msg: object | null): boolean {
    if (!msg || status !== "paired") return false;
    try {
      bridge.send(msg);
      return true;
    } catch {
      return false;
    }
  }

  function onPayload(type: BridgeEvent, payload: unknown) {
    if (status === "not connected" || !payload || typeof payload !== "object" || Array.isArray(payload)) return;
    // Until the app's first status event only that event counts.
    if (status !== "paired" && type !== "status") return;
    let raw: string;
    try {
      raw = JSON.stringify({ ...(payload as object), type });
    } catch {
      return;
    }
    const m = parseCompanionMessage(raw);
    if (!m) return;
    switch (m.type) {
      case "status":
        clearTimer();
        status = "paired";
        permissions = m.permissions;
        emitStatus();
        break;
      case "activity":
        for (const fn of listeners.activity) fn(m);
        break;
      case "app":
        for (const fn of listeners.app) fn(m);
        break;
      case "chord":
        for (const fn of listeners.chord) fn(m);
        break;
      case "shortcut":
        for (const fn of listeners.shortcut) fn(m.action);
        break;
    }
  }

  return {
    kind: "bridge",
    connect() {
      if (status !== "not connected") return;
      status = "connecting";
      permissions = null;
      timer = setTimeout(() => {
        timer = null;
        if (status !== "connecting") return;
        status = "not responding";
        emitStatus();
      }, statusTimeoutMs);
      offs = BRIDGE_EVENTS.map((type) => {
        try {
          const off = bridge.on(type, (p) => onPayload(type, p));
          return typeof off === "function" ? off : () => {};
        } catch {
          return () => {};
        }
      });
      emitStatus();
    },
    status: () => ({ kind: "bridge", status, permissions }),
    on(kind, fn) {
      (listeners[kind] as Set<typeof fn>).add(fn);
      return () => {
        (listeners[kind] as Set<typeof fn>).delete(fn);
      };
    },
    pair: () => false,
    showHalo: (id, rect, text) => send(outgoing.halo(id, rect, text)),
    clearHalo: (id) => send(outgoing.clearHalo(id)),
    buddyState: (s) => send(outgoing.buddyState(s)),
    buddySay: (t, ms) => send(outgoing.buddySay(t, ms)),
    buddyPoint: (p) => send(outgoing.buddyPoint(p)),
    buddyClear: (id) => send(outgoing.buddyClear(id)),
    sessionState: (s) => send({ type: "session.state", ...outgoing.sessionState(s) }),
    dockShow(side) {
      const ok = send({ type: "dock.show", side: outgoing.dockSide(side) });
      if (ok) dockShown = true;
      return ok;
    },
    dockHide() {
      dockShown = false;
      return send({ type: "dock.hide" });
    },
    dockLearned: (k, t) => send(outgoing.dockLearned(k, t)),
    dockNow: (t, app) => send(outgoing.dockNow(t, app)),
    dockAck: (t) => send(outgoing.dockAck(t)),
    window(action) {
      // The window belongs to the app's preload, so it works before the first status event too.
      if (status === "not connected" || !["step-aside", "restore", "focus"].includes(action)) return false;
      try {
        bridge.window(action);
        return true;
      } catch {
        return false;
      }
    },
    dispose() {
      if (status === "not connected") return;
      clearTimer();
      // The dock goes away with the page, like the WebSocket client.
      if (dockShown) send({ type: "dock.hide" });
      dockShown = false;
      for (const off of offs) {
        try {
          off();
        } catch {
          /* already gone */
        }
      }
      offs = [];
      status = "not connected";
      permissions = null;
      emitStatus();
    },
  };
}

/** Bridge when window.apprentice exists; WebSocket only when the setting enables it; else none. Client side only. */
export function selectTransport({
  win = typeof window === "undefined" ? undefined : window,
  storage = defaultStorage(),
  env = process.env.NEXT_PUBLIC_COMPANION_WS,
  createWs = () => createWebSocketTransport(),
}: {
  win?: unknown;
  storage?: KeyValueStore | null;
  env?: string;
  createWs?: () => CompanionTransport;
} = {}): CompanionTransport {
  const bridge = getBridge(win);
  if (bridge) return createBridgeTransport(bridge);
  if (wsTransportEnabled(storage, env)) return createWs();
  return createNoneTransport();
}
