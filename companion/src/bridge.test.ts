import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";
import { appAllowlist } from "./appConfig.mjs";
import {
  BRIDGE_CHANNELS,
  createForwarder,
  exposeBridge,
  routeBridgeMessage,
  senderAllowed,
  type BridgeHandlers,
  type BridgeInfo,
} from "./bridge.mjs";
import { appMessage, chordMessage, shortcutMessage, statusMessage, type ServerMessage } from "./protocol.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const packaged = appAllowlist({ appOrigin: "https://ai-apprentice.vercel.app", isPackaged: true, env: undefined });
const dev = appAllowlist({ appOrigin: "http://localhost:3000", isPackaged: false, env: undefined });
const status = statusMessage("0.1.0", { input: true, screen: true, accessibility: false });
const info = (): BridgeInfo => ({ version: "0.1.0", platform: "darwin", status });
const main = (url: string) => ({ isMainWebContents: true, isMainFrame: true, url });

type Listener = (event: unknown, msg: unknown) => void;

/** Runs the real preload (transpiled) with a fake 'electron'; any other require throws (sandbox rule). */
function loadPreload(hello: unknown) {
  const source = fs.readFileSync(path.join(here, "preloadApp.cts"), "utf8");
  const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exposed: Record<string, unknown> = {};
  const listeners = new Map<string, Listener>();
  const sent: unknown[][] = [];
  const electron = {
    contextBridge: { exposeInMainWorld: vi.fn((key: string, api: unknown) => (exposed[key] = api)) },
    ipcRenderer: {
      sendSync: vi.fn((channel: string) => (channel === BRIDGE_CHANNELS.hello ? hello : undefined)),
      send: (...args: unknown[]) => sent.push(args),
      on: (channel: string, l: Listener) => listeners.set(channel, l),
    },
  };
  const req = (id: string) => {
    if (id === "electron") return electron;
    throw new Error(`sandboxed preload cannot require ${id}`);
  };
  const mod = { exports: {} };
  new Function("require", "module", "exports", js)(req, mod, mod.exports);
  const emit = (msg: unknown) => listeners.get(BRIDGE_CHANNELS.event)?.(null, msg);
  return { api: exposed.apprentice as Apprentice | undefined, electron, sent, emit };
}

type Apprentice = {
  version: string;
  platform: string;
  on(type: string, h: (m: unknown) => void): () => void;
  send(m: unknown): void;
  window(a: string): void;
};

describe("bridge exposure", () => {
  it("exposes window.apprentice only when main answers hello for an allowlisted origin", () => {
    for (const url of ["https://ai-apprentice.vercel.app/", "https://ai-apprentice.vercel.app/control?x=1"]) {
      const hello = exposeBridge(main(url), packaged, info);
      expect(hello).not.toBeNull();
      const { api } = loadPreload(hello);
      expect(api?.version).toBe("0.1.0");
      expect(api?.platform).toBe("darwin");
    }
  });

  it("exposes nothing for look-alikes, other schemes, iframes and other windows", () => {
    const denied = [
      main("https://ai-apprentice.vercel.app.evil.com/"),
      main("https://evil-ai-apprentice.vercel.app/"),
      main("http://ai-apprentice.vercel.app/"),
      main("https://user@ai-apprentice.vercel.app/"),
      main("https://evil.com/?u=https://ai-apprentice.vercel.app"),
      main("file:///etc/passwd"),
      main("http://localhost:3000/"), // packaged: localhost not allowed
      { isMainWebContents: true, isMainFrame: false, url: "https://ai-apprentice.vercel.app/" },
      { isMainWebContents: false, isMainFrame: true, url: "https://ai-apprentice.vercel.app/" },
      main(""),
    ];
    for (const s of denied) {
      const hello = exposeBridge(s, packaged, info);
      expect(hello).toBeNull();
      const { api, electron } = loadPreload(hello);
      expect(api).toBeUndefined();
      expect(electron.contextBridge.exposeInMainWorld).not.toHaveBeenCalled();
    }
  });

  it("dev builds also allow localhost:3000 and the Vercel previews; packaged builds do not", () => {
    expect(senderAllowed(main("http://localhost:3000/train"), dev)).toBe(true);
    expect(senderAllowed(main("https://ai-apprentice-git-x-k3ntaws-projects.vercel.app/"), dev)).toBe(true);
    expect(senderAllowed(main("http://localhost:3001/"), dev)).toBe(false);
    expect(senderAllowed(main("https://ai-apprentice-git-x-k3ntaws-projects.vercel.app/"), packaged)).toBe(false);
  });

  it("the preload is self-contained: no local requires", () => {
    const source = fs.readFileSync(path.join(here, "preloadApp.cts"), "utf8");
    const imports = [...source.matchAll(/(?:from\s+|require\()\s*["']([^"']+)["']/g)].map((m) => m[1]);
    expect(imports).toEqual(["electron"]);
  });
});

describe("send() validation and routing", () => {
  const handlers = () => {
    const h = { onBuddy: vi.fn(), onSession: vi.fn(), onDock: vi.fn(), log: vi.fn() } satisfies BridgeHandlers;
    return h;
  };

  it("routes buddy, overlay, dock and session messages to their handlers", () => {
    const h = handlers();
    const rect = { x: 0.1, y: 0.1, w: 0.2, h: 0.2 };
    expect(routeBridgeMessage({ type: "buddy.state", state: "listening" }, h)).toBe(true);
    expect(routeBridgeMessage({ type: "buddy.say", text: "Hi" }, h)).toBe(true);
    expect(routeBridgeMessage({ type: "buddy.point", id: "a", rect, style: "glance" }, h)).toBe(true);
    expect(routeBridgeMessage({ type: "buddy.clear" }, h)).toBe(true);
    expect(routeBridgeMessage({ type: "overlay.halo", id: "h", rect }, h)).toBe(true);
    expect(routeBridgeMessage({ type: "overlay.clear", id: "h" }, h)).toBe(true);
    expect(h.onBuddy.mock.calls.map((c) => c[0].type)).toEqual(["state", "say", "point", "clear", "point", "clear"]);
    expect(h.onBuddy.mock.calls[4][0]).toMatchObject({ id: "h", style: "stop" });

    expect(routeBridgeMessage({ type: "dock.show", side: "left" }, h)).toBe(true);
    expect(routeBridgeMessage({ type: "dock.hide" }, h)).toBe(true);
    expect(routeBridgeMessage({ type: "dock.learned", kind: "shortcut", text: "Cmd+K opens search" }, h)).toBe(true);
    expect(h.onDock.mock.calls.map((c) => c[0].type)).toEqual(["dock.show", "dock.hide", "dock.learned"]);

    const session = { type: "session.state", mode: "capture", title: "T", expert: "Sabine", asked: 1, guardrails: 0, last_question: "", last_answer: "", off_record: false, app_url: "https://ai-apprentice.vercel.app/" };
    expect(routeBridgeMessage(session, h)).toBe(true);
    expect(h.onSession).toHaveBeenCalledWith(expect.objectContaining({ type: "session.state", mode: "capture" }));
  });

  it("drops invalid messages and types the bridge does not carry", () => {
    const h = handlers();
    const cyclic: Record<string, unknown> = { type: "buddy.say" };
    cyclic.self = cyclic;
    for (const bad of [
      null,
      42,
      "not json",
      { type: "buddy.state", state: "dancing" },
      { type: "buddy.say", text: "x".repeat(281) },
      { type: "buddy.point", id: "a", rect: { x: 2, y: 0, w: 0.1, h: 0.1 }, style: "stop" },
      { type: "dock.learned", kind: "secret", text: "x" },
      { type: "hello", token: "123456" },
      { type: "ping" },
      { type: "eval", code: "1" },
      cyclic,
    ]) {
      expect(routeBridgeMessage(bad, h)).toBe(false);
    }
    expect(h.onBuddy).not.toHaveBeenCalled();
    expect(h.onDock).not.toHaveBeenCalled();
    expect(h.onSession).not.toHaveBeenCalled();
  });

  it("preload send() and window() reach main on the bridge channels; unknown window actions are dropped", () => {
    const { api, sent } = loadPreload(info());
    api!.send({ type: "buddy.clear" });
    api!.window("step-aside");
    api!.window("close-everything");
    expect(sent).toEqual([
      [BRIDGE_CHANNELS.send, { type: "buddy.clear" }],
      [BRIDGE_CHANNELS.window, "step-aside"],
    ]);
  });
});

describe("on() and app -> web events", () => {
  it("delivers activity, app, chord and shortcut events to subscribers, and unsubscribe stops them", async () => {
    const { api, emit } = loadPreload(info());
    const got: Record<string, unknown[]> = {};
    const offs = ["activity", "app", "chord", "shortcut"].map((t) => api!.on(t, (m) => (got[t] ??= []).push(m)));
    const msgs: ServerMessage[] = [
      { type: "activity", t: 1, typing: true, pointer: false, keys: 3, clicks: 0, idle_ms: 0 },
      appMessage(2, "Microsoft Outlook", "Inbox"),
      chordMessage(3, "Cmd+Shift+T", "Safari"),
      shortcutMessage("talk_start"),
    ];
    for (const m of msgs) emit(m);
    expect(got.activity).toEqual([msgs[0]]);
    expect(got.app).toEqual([msgs[1]]);
    expect(got.chord).toEqual([msgs[2]]);
    expect(got.shortcut).toEqual([msgs[3]]);
    offs.forEach((off) => off());
    emit(msgs[1]);
    expect(got.app).toHaveLength(1);
    // Unknown subscription types and unknown event types are ignored.
    const h = vi.fn();
    api!.on("pong", h);
    emit({ type: "pong" });
    expect(h).not.toHaveBeenCalled();
  });

  it("replays the last status to a new status subscriber", async () => {
    const { api, emit } = loadPreload(info());
    const first = vi.fn();
    api!.on("status", first);
    await Promise.resolve();
    expect(first).toHaveBeenCalledWith(status);
    const next = statusMessage("0.1.0", { input: true, screen: false, accessibility: true }, true);
    emit(next);
    const late = vi.fn();
    api!.on("status", late);
    await Promise.resolve();
    expect(late).toHaveBeenCalledWith(next);
  });

  it("the forwarder sends bridge events to the page and everything to the WebSocket when enabled", () => {
    const page = { send: vi.fn() };
    const ws = { send: vi.fn() };
    const both = createForwarder({ ws: () => ws, page: () => page });
    both(chordMessage(1, "Cmd+K", "Notes"));
    both({ type: "pong" });
    expect(page.send).toHaveBeenCalledTimes(1);
    expect(page.send).toHaveBeenCalledWith(BRIDGE_CHANNELS.event, expect.objectContaining({ type: "chord" }));
    expect(ws.send).toHaveBeenCalledTimes(2);

    const pageOnly = createForwarder({ ws: () => null, page: () => page });
    pageOnly(statusMessage("0.1.0", { input: false, screen: false, accessibility: false }));
    expect(page.send).toHaveBeenCalledTimes(2);

    const noPage = createForwarder({ ws: () => null, page: () => null });
    expect(() => noPage(shortcutMessage("end_task"))).not.toThrow();
  });
});
