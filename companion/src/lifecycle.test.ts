import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { installLifecycle, mainCloseAction, quitOnAllClosed, type LifecycleApp } from "./lifecycle.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

// Electron mocked: main.mts is imported for real (whenReady never resolves, so boot does not run).
const h = vi.hoisted(() => ({ handlers: new Map<string, (() => void)[]>(), Tray: { calls: 0 }, quit: { calls: 0 }, dockHide: { calls: 0 } }));
vi.mock("electron", async () => {
  const os = await import("node:os");
  const stub = (): unknown =>
    new Proxy(function () {}, { get: (_t, k) => (k === "then" ? undefined : stub()), apply: () => stub(), construct: () => stub() as object });
  const own: Record<string, unknown> = {
    on(ev: string, fn: () => void) {
      h.handlers.set(ev, [...(h.handlers.get(ev) ?? []), fn]);
      return app;
    },
    getPath: () => os.tmpdir(),
    requestSingleInstanceLock: () => true,
    whenReady: () => new Promise(() => {}),
    isReady: () => false,
    isPackaged: false,
    getVersion: () => "0.0.0",
    quit: () => void h.quit.calls++,
    dock: { hide: () => void h.dockHide.calls++, show: () => Promise.resolve() },
  };
  const app: unknown = new Proxy(own, { get: (t, k) => (typeof k === "string" && k in t ? t[k] : stub()) });
  class Tray {
    constructor() {
      h.Tray.calls++;
    }
  }
  return {
    app,
    Tray,
    BrowserWindow: stub(),
    desktopCapturer: stub(),
    globalShortcut: stub(),
    ipcMain: stub(),
    Menu: stub(),
    nativeImage: stub(),
    powerMonitor: stub(),
    screen: stub(),
    session: stub(),
    shell: stub(),
    systemPreferences: stub(),
  };
});

function fakeApp() {
  const on = new Map<string, () => void>();
  const app: LifecycleApp & { quits: number } = {
    quits: 0,
    on(ev, fn) {
      on.set(ev, fn);
    },
    quit() {
      app.quits++;
    },
  };
  return { app, fire: (ev: string) => on.get(ev)?.() };
}

describe("main process without a menu-bar item", () => {
  it("constructs no Tray, never hides the Dock icon and registers activate and window-all-closed", async () => {
    await import("./main.mjs");
    expect(h.Tray.calls).toBe(0);
    expect(h.dockHide.calls).toBe(0);
    expect(h.handlers.get("activate")?.length).toBeGreaterThan(0);
    expect(h.handlers.get("window-all-closed")).toHaveLength(1);
    // This test runs on macOS or Linux: closing every window does not quit.
    if (process.platform !== "win32") {
      h.handlers.get("window-all-closed")![0]();
      expect(h.quit.calls).toBe(0);
    }
  });

  it("main.mts has no Tray, no dock.hide and no tray asset; the close handler follows mainCloseAction", () => {
    const src = fs.readFileSync(path.join(here, "main.mts"), "utf8");
    expect(src).not.toMatch(/\bTray\b/);
    expect(src).not.toMatch(/app\.dock\??\.hide/);
    expect(src).not.toContain("trayIcon");
    expect(fs.existsSync(path.join(here, "trayIcon.mts"))).toBe(false);
    expect(fs.existsSync(path.join(here, "..", "static", "icon.ico"))).toBe(false);
    const start = src.indexOf('win.on("close"');
    const body = src.slice(start, src.indexOf("\n  });", start));
    expect(body).toContain("mainCloseAction({ quitting, platform: process.platform, sessionActive: sessionRunning() })");
    expect(body).toContain("e.preventDefault()");
    expect(body).toContain("win.hide()");
    expect(body).not.toContain("destroy");
  });
});

describe("app lifecycle", () => {
  it("activate reopens the main window only when none is visible", () => {
    let visible = false;
    const showMain = vi.fn(() => void (visible = true));
    const { app, fire } = fakeApp();
    installLifecycle(app, { platform: "darwin", mainVisible: () => visible, showMain, sessionActive: () => false });
    fire("activate");
    expect(showMain).toHaveBeenCalledTimes(1);
    fire("activate");
    expect(showMain).toHaveBeenCalledTimes(1);
  });

  it("window-all-closed quits on win32 and not on darwin", () => {
    for (const [platform, quits] of [
      ["win32", 1],
      ["darwin", 0],
    ] as const) {
      const { app, fire } = fakeApp();
      installLifecycle(app, { platform, mainVisible: () => false, showMain: () => {}, sessionActive: () => false });
      fire("window-all-closed");
      expect(app.quits, platform).toBe(quits);
    }
    expect(quitOnAllClosed("win32", true)).toBe(false);
  });

  it("closing the main window during a session only hides it (session, dock and buddy keep running)", () => {
    for (const platform of ["darwin", "win32"] as const) {
      expect(mainCloseAction({ quitting: false, platform, sessionActive: true })).toBe("hide");
    }
    const { app, fire } = fakeApp();
    installLifecycle(app, { platform: "win32", mainVisible: () => false, showMain: () => {}, sessionActive: () => true });
    fire("window-all-closed");
    expect(app.quits).toBe(0);
  });

  it("without a session macOS keeps the app in the Dock and Windows quits; quitting always closes", () => {
    expect(mainCloseAction({ quitting: false, platform: "darwin", sessionActive: false })).toBe("hide");
    expect(mainCloseAction({ quitting: false, platform: "win32", sessionActive: false })).toBe("quit");
    expect(mainCloseAction({ quitting: true, platform: "darwin", sessionActive: true })).toBe("allow");
  });

  it("End task in the dock restores the main window", () => {
    const src = fs.readFileSync(path.join(here, "main.mts"), "utf8");
    const start = src.indexOf('ipcMain.on("dock-action"');
    const body = src.slice(start, src.indexOf("\n});", start));
    expect(body).toMatch(/if \(action === "end_task"\) showMain\(\);/);
  });
});
