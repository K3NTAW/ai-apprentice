// Test kit (not shipped): a fake desktop app for the Capture and Teach share tests. window.apprentice records
// window actions, navigator.mediaDevices.getDisplayMedia is controllable (resolve, reject, hold), the captured
// track can end by itself, and document.createElement returns just enough of a video/canvas for
// startScreenCapture. install() puts them on globalThis; uninstall() restores the originals.
import type { ApprenticeBridge, BridgeEvent } from "./transport";

type Listener = () => void;

export function fakeDesktop() {
  const log: string[] = [];
  const handlers = new Map<BridgeEvent, (p: unknown) => void>();
  const bridge: ApprenticeBridge = {
    version: "1.0.0",
    platform: "darwin",
    on(type, handler) {
      handlers.set(type, handler);
      return () => void handlers.delete(type);
    },
    send: () => {},
    window: (a) => void log.push(`window:${a}`),
  };

  let ended: Listener | null = null;
  const track = {
    stopped: 0,
    stop() {
      track.stopped++;
    },
    getSettings: () => ({ displaySurface: "monitor" }),
    addEventListener(type: string, fn: Listener) {
      if (type === "ended") ended = fn;
    },
  };
  const stream = { getVideoTracks: () => [track], getTracks: () => [track] };

  let next: "resolve" | "reject" | "hold" = "resolve";
  let release: (() => void) | null = null;
  let playFails = false;
  const getDisplayMedia = async (opts: unknown) => {
    log.push("getDisplayMedia");
    calls.push(opts);
    if (next === "reject") throw new Error("Permission denied");
    if (next === "hold") await new Promise<void>((r) => (release = r));
    return stream;
  };
  const calls: unknown[] = [];
  const element = () => ({
    muted: false,
    playsInline: false,
    srcObject: null as unknown,
    videoWidth: 0,
    videoHeight: 0,
    play: async () => {
      if (playFails) throw new Error("video failed");
    },
    getContext: () => null,
  });

  const saved = new Map<string, PropertyDescriptor | undefined>();
  const put = (name: string, value: unknown) => {
    saved.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  };

  return {
    log,
    track,
    getDisplayMediaCalls: calls,
    /** Fires a bridge event the way the desktop app's preload does. */
    emit: (type: BridgeEvent, payload: unknown) => handlers.get(type)?.(payload),
    paired() {
      handlers.get("status")?.({ version: "1.0.0", permissions: { input: true, screen: true, accessibility: true } });
    },
    nextShare(mode: "resolve" | "reject" | "hold") {
      next = mode;
    },
    failVideo() {
      playFails = true;
    },
    /** Lets a held getDisplayMedia resolve. */
    release() {
      release?.();
      release = null;
    },
    /** The captured stream ends by itself (the user or the OS stopped it). */
    endStream() {
      ended?.();
    },
    install() {
      put("window", { apprentice: bridge, location: { search: "", href: "http://app.test/" } });
      put("navigator", { mediaDevices: { getDisplayMedia } });
      put("document", { createElement: element });
    },
    uninstall() {
      for (const [name, d] of saved) {
        if (d) Object.defineProperty(globalThis, name, d);
        else delete (globalThis as Record<string, unknown>)[name];
      }
      saved.clear();
    },
  };
}

/** Lets pending promise callbacks run. */
export const flush = () => new Promise<void>((r) => setTimeout(r, 0));
