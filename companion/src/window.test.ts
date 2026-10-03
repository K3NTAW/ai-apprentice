import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { appAllowlist, resolveAppUrl, validateAppUrl, wsEnabled } from "./appConfig.mjs";
import { isWindowAction, MAIN_WINDOW, planWindowAction, restoreWindowBounds, serializeWindowBounds, type WindowSnapshot } from "./windowActions.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const open: WindowSnapshot = { visible: true, minimized: false, fullscreen: false };

describe("window actions", () => {
  it("step-aside minimises the main window once (idempotent)", () => {
    const a = planWindowAction("step-aside", open, false);
    expect(a).toEqual({ ops: ["minimize"], steppedAside: true });
    expect(planWindowAction("step-aside", { ...open, minimized: true }, true)).toEqual({ ops: [], steppedAside: true });
  });

  it("step-aside leaves fullscreen first and leaves a window the user already hid alone", () => {
    expect(planWindowAction("step-aside", { ...open, fullscreen: true }, false).ops).toEqual(["leave-fullscreen", "minimize"]);
    expect(planWindowAction("step-aside", { ...open, visible: false }, false)).toEqual({ ops: [], steppedAside: false });
    expect(planWindowAction("step-aside", { ...open, minimized: true }, false)).toEqual({ ops: [], steppedAside: false });
  });

  it("restore brings the window back only after a step-aside", () => {
    expect(planWindowAction("restore", { ...open, minimized: true }, true)).toEqual({ ops: ["restore", "focus"], steppedAside: false });
    expect(planWindowAction("restore", { ...open, minimized: true }, false)).toEqual({ ops: [], steppedAside: false });
  });

  it("focus shows, restores and focuses, and ends a step-aside", () => {
    expect(planWindowAction("focus", open, false)).toEqual({ ops: ["focus"], steppedAside: false });
    expect(planWindowAction("focus", { visible: false, minimized: true, fullscreen: false }, true)).toEqual({ ops: ["show", "restore", "focus"], steppedAside: false });
  });

  it("only the three bridge actions are accepted", () => {
    expect(["step-aside", "restore", "focus"].every(isWindowAction)).toBe(true);
    for (const v of ["close", "minimize", "", null, 1, "FOCUS"]) expect(isWindowAction(v)).toBe(false);
  });
});

describe("window state", () => {
  const areas = [{ x: 0, y: 25, width: 1512, height: 920 }];

  it("defaults to 1280x820 for a missing or corrupt file", () => {
    for (const t of [null, "{", "[]", '{"x":"1"}']) expect(restoreWindowBounds(t, areas)).toEqual({ width: MAIN_WINDOW.width, height: MAIN_WINDOW.height });
  });

  it("restores saved bounds on a current display, clamped to the work area and the minimum size", () => {
    expect(restoreWindowBounds(serializeWindowBounds({ x: 40, y: 60, width: 1100, height: 700 }), areas)).toEqual({ x: 40, y: 60, width: 1100, height: 700 });
    expect(restoreWindowBounds(serializeWindowBounds({ x: 0, y: 25, width: 5000, height: 300 }), areas)).toEqual({ x: 0, y: 25, width: 1512, height: 640 });
  });

  it("ignores a position on a display that is gone", () => {
    expect(restoreWindowBounds(serializeWindowBounds({ x: 2000, y: 100, width: 1280, height: 820 }), areas)).toEqual({ width: 1280, height: 820 });
  });
});

describe("app config and the WebSocket switch", () => {
  it("the WebSocket server does not start unless COMPANION_WS=1", () => {
    expect(wsEnabled({})).toBe(false);
    for (const v of ["0", "", "true", "yes", " 1"]) expect(wsEnabled({ COMPANION_WS: v })).toBe(false);
    expect(wsEnabled({ COMPANION_WS: "1" })).toBe(true);
  });

  it("main.mts starts the server and pairing only behind COMPANION_WS=1", () => {
    const src = fs.readFileSync(path.join(here, "main.mts"), "utf8");
    expect(src).toMatch(/const wsOn = wsEnabled\(process\.env\);/);
    expect(src).toMatch(/const pairing = wsOn\s*\?/);
    expect(src).toMatch(/async function startWsServer\(\): Promise<void> \{\n\s+if \(!pairing\) return;/);
    expect(src.match(/startServer\(/g)).toHaveLength(1);
  });

  it("APP_URL: env first, then config, then stored; no default; invalid is an error", () => {
    const config = JSON.stringify({ appUrl: "https://app.example.com" });
    expect(resolveAppUrl({ env: undefined, configText: config, storedText: null })).toMatchObject({ ok: true, origin: "https://app.example.com" });
    expect(resolveAppUrl({ env: "https://staging.example.com/app", configText: config, storedText: null })).toMatchObject({ ok: true, origin: "https://staging.example.com" });
    expect(resolveAppUrl({ env: "http://localhost:3000", configText: null, storedText: null })).toMatchObject({ ok: true, origin: "http://localhost:3000" });
    expect(resolveAppUrl({ env: "http://example.com", configText: config, storedText: null })).toEqual({ ok: false, reason: "app_url_scheme" });
    expect(resolveAppUrl({ env: undefined, configText: "{", storedText: null })).toEqual({ ok: false, reason: "app_url_unset" });
    expect(validateAppUrl("https://u:p@example.com")).toEqual({ ok: false, reason: "app_url_userinfo" });
  });

  it("packaged allowlist is the APP_URL origin only; dev adds localhost:3000 only", () => {
    expect(appAllowlist({ appOrigin: "https://app.example.com", isPackaged: true, env: undefined }).rules.map((r) => r.source)).toEqual([
      "https://app.example.com",
    ]);
    expect(appAllowlist({ appOrigin: "https://app.example.com", isPackaged: false, env: undefined }).rules.map((r) => r.source)).toEqual([
      "https://app.example.com",
      "http://localhost:3000",
    ]);
  });

  it("overlay, dock (buddy is drawn in the overlays) and panel windows use content protection", () => {
    const src = fs.readFileSync(path.join(here, "main.mts"), "utf8");
    for (const fn of ["function createOverlay(", "function createDock(", "function showPanel("]) {
      const start = src.indexOf(fn);
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start, src.indexOf("\n}\n", start));
      expect(body, fn).toContain("setContentProtection(true)");
    }
  });
});
