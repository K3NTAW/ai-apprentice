import { afterEach, describe, expect, it, vi } from "vitest";
import { bindCaptureTransport, captureCompanionSink } from "@/lib/capture/companionWiring";
import { bindTeachTransport, stopPointSink } from "@/lib/teach/companionBridge";
import type { CompanionListeners, KeyValueStore } from "./client";
import { createShareFlow, createStepAside } from "./stepAside";
import {
  BRIDGE_STATUS_TIMEOUT_MS,
  createBridgeTransport,
  createNoneTransport,
  selectTransport,
  WS_SETTING_KEY,
  wsTransportEnabled,
  type ApprenticeBridge,
  type BridgeEvent,
  type CompanionTransport,
  type WindowAction,
} from "./transport";

function fakeBridge() {
  const handlers = new Map<BridgeEvent, (p: unknown) => void>();
  const sent: object[] = [];
  const windows: WindowAction[] = [];
  const unsubscribed: BridgeEvent[] = [];
  const bridge: ApprenticeBridge = {
    version: "1.0.0",
    platform: "darwin",
    on(type, handler) {
      handlers.set(type, handler);
      return () => {
        unsubscribed.push(type);
        handlers.delete(type);
      };
    },
    send: (m) => void sent.push(m),
    window: (a) => void windows.push(a),
  };
  return { bridge, handlers, sent, windows, unsubscribed, emit: (t: BridgeEvent, p: unknown) => handlers.get(t)?.(p) };
}

const memStore = (v: string | null): KeyValueStore => ({ getItem: () => v, setItem: () => {}, removeItem: () => {} });

/** A fake transport: records every web -> app message and lets the test emit app -> web events. */
function fakeTransport(kind: CompanionTransport["kind"] = "bridge") {
  const listeners: { [K in keyof CompanionListeners]: Set<CompanionListeners[K]> } = {
    status: new Set(),
    activity: new Set(),
    app: new Set(),
    shortcut: new Set(),
    chord: new Set(),
  };
  const sent: [string, unknown[]][] = [];
  const rec =
    (name: string) =>
    (...args: unknown[]) => {
      sent.push([name, args]);
      return true;
    };
  const t: CompanionTransport = {
    kind,
    connect() {},
    status: () => ({ kind, status: "paired", permissions: null }),
    on(k, fn) {
      (listeners[k] as Set<typeof fn>).add(fn);
      return () => void (listeners[k] as Set<typeof fn>).delete(fn);
    },
    pair: () => false,
    showHalo: rec("showHalo"),
    clearHalo: rec("clearHalo"),
    buddyState: rec("buddyState"),
    buddySay: rec("buddySay"),
    buddyPoint: rec("buddyPoint"),
    buddyClear: rec("buddyClear"),
    sessionState: rec("sessionState"),
    dockShow: rec("dockShow"),
    dockHide: rec("dockHide"),
    dockLearned: rec("dockLearned"),
    dockNow: rec("dockNow"),
    dockAck: rec("dockAck"),
    window: rec("window"),
    dispose() {},
  };
  const emit = <K extends keyof CompanionListeners>(k: K, ...args: Parameters<CompanionListeners[K]>) => {
    for (const fn of listeners[k]) (fn as (...a: unknown[]) => void)(...args);
  };
  const count = () => Object.values(listeners).reduce((n, s) => n + s.size, 0);
  return { t, sent, emit, count };
}

describe("transport selection", () => {
  it("selects the bridge when window.apprentice exists", () => {
    const { bridge } = fakeBridge();
    expect(selectTransport({ win: { apprentice: bridge }, storage: memStore("1"), env: "1" }).kind).toBe("bridge");
  });

  it("a plain browser gets no transport by default", () => {
    const createWs = vi.fn();
    const t = selectTransport({ win: {}, storage: memStore(null), env: undefined, createWs });
    expect(t.kind).toBe("none");
    expect(createWs).not.toHaveBeenCalled();
    expect(t.status()).toEqual({ kind: "none", status: "not connected", permissions: null });
    expect(t.buddySay("hi")).toBe(false);
    expect(t.window("step-aside")).toBe(false);
  });

  it("a malformed window.apprentice is not a bridge", () => {
    expect(selectTransport({ win: { apprentice: { on: 1 } }, storage: null, env: undefined }).kind).toBe("none");
  });

  it("WebSocket only when the setting enables it (localStorage key or NEXT_PUBLIC_COMPANION_WS=1)", () => {
    const ws = createNoneTransport();
    const createWs = () => ({ ...ws, kind: "websocket" as const });
    expect(WS_SETTING_KEY).toBe("ai-apprentice.companion.ws");
    expect(wsTransportEnabled(memStore(null), undefined)).toBe(false);
    expect(wsTransportEnabled(memStore("0"), "0")).toBe(false);
    expect(selectTransport({ win: {}, storage: memStore("1"), env: undefined, createWs }).kind).toBe("websocket");
    expect(selectTransport({ win: {}, storage: null, env: "1", createWs }).kind).toBe("websocket");
  });
});

describe("bridge transport", () => {
  it("sends protocol messages, validates incoming payloads and controls the window", () => {
    const b = fakeBridge();
    const t = createBridgeTransport(b.bridge);
    const status = vi.fn();
    const chords = vi.fn();
    t.on("status", status);
    t.on("chord", chords);
    expect(t.buddySay("before connect")).toBe(false);
    t.connect();
    expect(status).toHaveBeenLastCalledWith("connecting", null);
    b.emit("status", { version: "1.0.0", permissions: { input: true, screen: false, accessibility: true } });
    expect(status).toHaveBeenLastCalledWith("paired", { input: true, screen: false, accessibility: true });
    expect(t.status()).toEqual({ kind: "bridge", status: "paired", permissions: { input: true, screen: false, accessibility: true } });
    b.emit("chord", { t: 1, chord: "Cmd+Shift+T", app: "Excel" });
    b.emit("chord", { t: 1, chord: "a", app: "Excel" }); // plain typing is dropped
    b.emit("chord", "junk");
    expect(chords).toHaveBeenCalledTimes(1);
    expect(chords).toHaveBeenCalledWith({ type: "chord", t: 1, chord: "Cmd+Shift+T", app: "Excel" });

    t.buddyPoint({ id: "g", rect: { x: 2, y: 0.5, w: 0.1, h: 0.1 }, style: "stop", text: "Stop" });
    t.dockShow("left");
    t.dockLearned("shortcut", "Cmd+K opens search");
    expect(b.sent).toEqual([
      { type: "buddy.point", id: "g", rect: { x: 1, y: 0.5, w: 0.1, h: 0.1 }, style: "stop", text: "Stop" },
      { type: "dock.show", side: "left" },
      { type: "dock.learned", kind: "shortcut", text: "Cmd+K opens search" },
    ]);
    expect(t.window("step-aside")).toBe(true);
    expect(b.windows).toEqual(["step-aside"]);
  });

  it("dispose is idempotent, calls every unsubscribe once and hides the dock", () => {
    const b = fakeBridge();
    const t = createBridgeTransport(b.bridge);
    t.connect();
    b.emit("status", { version: "1.0.0", permissions: { input: true, screen: true, accessibility: true } });
    t.dockShow();
    t.dispose();
    t.dispose();
    expect(b.unsubscribed.sort()).toEqual(["activity", "app", "chord", "shortcut", "status"]);
    expect(b.sent.at(-1)).toEqual({ type: "dock.hide" });
    expect(b.sent.filter((m) => (m as { type: string }).type === "dock.hide")).toHaveLength(1);
    expect(t.status().status).toBe("not connected");
    expect(t.buddyState("idle")).toBe(false);
  });
});

describe("bridge status honesty (fix round T-0123)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });
  const perms = { input: true, screen: true, accessibility: true };

  it("is 'connecting' with permissions unknown until the first status event, then paired", () => {
    vi.useFakeTimers();
    const b = fakeBridge();
    const t = createBridgeTransport(b.bridge);
    const status = vi.fn();
    t.on("status", status);
    t.connect();
    expect(t.status()).toEqual({ kind: "bridge", status: "connecting", permissions: null });
    expect(t.buddySay("too early")).toBe(false);
    b.emit("chord", { t: 1, chord: "Cmd+Shift+T", app: "Excel" }); // nothing but status counts yet
    vi.advanceTimersByTime(BRIDGE_STATUS_TIMEOUT_MS - 1);
    expect(t.status().status).toBe("connecting");
    b.emit("status", { version: "1.0.0", permissions: perms });
    expect(t.status()).toEqual({ kind: "bridge", status: "paired", permissions: perms });
    vi.advanceTimersByTime(10_000);
    expect(t.status().status).toBe("paired");
    expect(status.mock.calls.map(([s]) => s)).toEqual(["connecting", "paired"]);
    expect(t.buddySay("hi")).toBe(true);
  });

  it("'App not responding' after 3 s without a status event; a late event still pairs", () => {
    vi.useFakeTimers();
    const b = fakeBridge();
    const t = createBridgeTransport(b.bridge);
    const status = vi.fn();
    t.on("status", status);
    t.connect();
    vi.advanceTimersByTime(BRIDGE_STATUS_TIMEOUT_MS);
    expect(t.status()).toEqual({ kind: "bridge", status: "not responding", permissions: null });
    expect(status).toHaveBeenLastCalledWith("not responding", null);
    b.emit("status", { version: "1.0.0", permissions: perms });
    expect(t.status().status).toBe("paired");
  });

  it("dispose before the timeout stops the timer", () => {
    vi.useFakeTimers();
    const b = fakeBridge();
    const t = createBridgeTransport(b.bridge);
    const status = vi.fn();
    t.on("status", status);
    t.connect();
    t.dispose();
    vi.advanceTimersByTime(BRIDGE_STATUS_TIMEOUT_MS * 2);
    expect(status.mock.calls.map(([s]) => s)).toEqual(["connecting", "not connected"]);
  });
});

describe("callers use the transport interface", () => {
  it("Capture: buddy/dock/session messages go to the transport; chord/activity/app/shortcut come back", () => {
    const f = fakeTransport();
    const sink = captureCompanionSink(() => f.t);
    sink.buddyState("listening");
    sink.buddySay("Why this step?");
    sink.buddyPoint({ id: "p", rect: { x: 0, y: 0, w: 1, h: 1 }, style: "glance" });
    sink.dockShow?.("right");
    sink.dockLearned?.("step", "Open the email");
    sink.sessionState({ mode: "capture", title: "t", expert: "Sabine", asked: 1, guardrails: 0, last_question: "", last_answer: "", off_record: false, app_url: "" });
    expect(f.sent.map(([n]) => n)).toEqual(["buddyState", "buddySay", "buddyPoint", "dockShow", "dockLearned", "sessionState"]);

    const ctrl = { onCompanionActivity: vi.fn(), onCompanionApp: vi.fn(), onCompanionChord: vi.fn(), onCompanionDisconnected: vi.fn() };
    let running = false;
    const shortcuts = vi.fn();
    const off = bindCaptureTransport(f.t, { ctrl: () => (running ? ctrl : null), onStatus: () => {}, onShortcut: shortcuts });
    const chord = { type: "chord" as const, t: 1, chord: "Cmd+S", app: "Excel" };
    f.emit("chord", chord); // no session: dropped
    running = true;
    f.emit("chord", chord);
    f.emit("activity", { type: "activity", t: 1, typing: true, pointer: false, keys: 3, clicks: 0, idle_ms: 0 });
    f.emit("app", { type: "app", t: 1, app: "Excel", title: "Book1" });
    f.emit("shortcut", "end_task");
    f.emit("status", "not connected", null);
    expect(ctrl.onCompanionChord).toHaveBeenCalledTimes(1);
    expect(ctrl.onCompanionChord).toHaveBeenCalledWith(chord);
    expect(ctrl.onCompanionActivity).toHaveBeenCalledTimes(1);
    expect(ctrl.onCompanionApp).toHaveBeenCalledTimes(1);
    expect(ctrl.onCompanionDisconnected).toHaveBeenCalledTimes(1);
    expect(shortcuts).toHaveBeenCalledWith("end_task");
    off();
    expect(f.count()).toBe(0);
  });

  it("Teach: stop points go to the transport; chord/activity only during a session, shortcuts always", () => {
    const f = fakeTransport();
    const sink = stopPointSink(() => f.t);
    sink.showHalo("iv_1", { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, "Stop");
    sink.clearHalo("iv_1");
    expect(f.sent).toEqual([
      ["buddyPoint", [{ id: "iv_1", rect: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 }, style: "stop", text: "Stop" }]],
      ["buddyClear", ["iv_1"]],
    ]);
    let active = false;
    const h = { active: () => active, onStatus: vi.fn(), onActivity: vi.fn(), onChord: vi.fn(), onShortcut: vi.fn() };
    const off = bindTeachTransport(f.t, h);
    const activity = { type: "activity" as const, t: 1, typing: false, pointer: true, keys: 0, clicks: 1, idle_ms: 900 };
    f.emit("activity", activity);
    f.emit("chord", { type: "chord", t: 1, chord: "Ctrl+C", app: "Excel" });
    expect(h.onActivity).not.toHaveBeenCalled();
    expect(h.onChord).not.toHaveBeenCalled();
    active = true;
    f.emit("activity", activity);
    f.emit("chord", { type: "chord", t: 1, chord: "Ctrl+C", app: "Excel" });
    f.emit("shortcut", "pause_toggle");
    expect(h.onActivity).toHaveBeenCalledWith(activity);
    expect(h.onChord).toHaveBeenCalledTimes(1);
    expect(h.onShortcut).toHaveBeenCalledWith("pause_toggle");
    off();
    expect(f.count()).toBe(0);
  });
});

describe("step aside and restore", () => {
  const order = (kind: CompanionTransport["kind"] = "bridge") => {
    const f = fakeTransport(kind);
    const log: string[] = [];
    f.t.window = (a) => {
      log.push(`window:${a}`);
      return true;
    };
    return { f, log, sa: createStepAside(() => f.t) };
  };

  it("Start: getDisplayMedia first, then step-aside; End restores once (idempotent)", async () => {
    const { log, sa } = order();
    await sa.share(async () => {
      log.push("getDisplayMedia");
      return "handle";
    });
    expect(log).toEqual(["getDisplayMedia", "window:step-aside"]);
    expect(sa.restore()).toBe(true);
    expect(sa.restore()).toBe(false);
    expect(log).toEqual(["getDisplayMedia", "window:step-aside", "window:restore"]);
  });

  it("a rejected getDisplayMedia never steps aside; restore sends one restore, then is a no-op", async () => {
    const { log, sa } = order();
    await expect(sa.share(async () => Promise.reject(new Error("denied")))).rejects.toThrow("denied");
    expect(sa.restore()).toBe(true);
    expect(sa.restore()).toBe(false);
    expect(log).toEqual(["window:restore"]);
  });

  it("restore while the share is pending cancels the later step-aside", async () => {
    const { log, sa } = order();
    let resolve!: (v: string) => void;
    const p = sa.share(() => new Promise<string>((r) => (resolve = r)));
    expect(sa.restore()).toBe(true);
    resolve("h");
    await p;
    expect(sa.isAside()).toBe(false);
    expect(sa.restore()).toBe(false);
    expect(log).toEqual(["window:restore"]);
  });

  it("stepAside false (voice did not start) shares without stepping aside or restoring", async () => {
    const { log, sa } = order();
    await sa.share(async () => "h", { stepAside: false });
    expect(sa.restore()).toBe(false);
    expect(log).toEqual([]);
  });

  it("the share flow stops a handle that arrives after stop()", async () => {
    const { log, f } = order();
    const flow = createShareFlow<{ stop(): void }>(() => f.t);
    const stop = vi.fn();
    let resolve!: (v: { stop(): void }) => void;
    const p = flow.start(() => new Promise((r) => (resolve = r)));
    flow.stop();
    resolve({ stop });
    expect(await p).toBeNull();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(log).toEqual(["window:restore"]);
  });

  it.each(["finish", "error", "stream ended", "unmount"])("restore on %s after a share", async () => {
    const { log, sa } = order();
    await sa.share(async () => "h");
    sa.restore();
    expect(log.at(-1)).toBe("window:restore");
  });

  it("outside the app nothing steps aside", async () => {
    const { log, sa } = order("none");
    await sa.share(async () => "h");
    expect(sa.isAside()).toBe(false);
    expect(log).toEqual([]);
  });
});
