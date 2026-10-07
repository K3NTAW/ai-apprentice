// main.mts cannot be launched here (Electron): string checks over the source, like the e2e guard tests.
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const main = fs.readFileSync(new URL("./main.mts", import.meta.url), "utf8");
const preload = fs.readFileSync(new URL("./preloadApp.cts", import.meta.url), "utf8");

/** Body of the first `app.on("before-quit", () => { ... })` handler. */
function beforeQuitBody(src: string): string {
  const start = src.indexOf('app.on("before-quit"');
  expect(start).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}" && --depth === 0) return src.slice(open, i + 1);
  }
  throw new Error("unbalanced before-quit handler");
}

describe("main.mts updater and crash wiring", () => {
  it("gets electron-updater through createRequire, not an ESM import", () => {
    expect(main).toContain("const require = createRequire(import.meta.url);");
    expect(main).toContain('require("electron-updater")');
    expect(main).not.toMatch(/import[^;]*from\s+["']electron-updater["']/);
  });

  it("enables the updater only on packaged darwin with updates:true", () => {
    expect(main).toMatch(/process\.platform === "darwin" && app\.isPackaged && readUpdatesFlag\(/);
    expect(main).toMatch(/enabled: updatesEnabled/);
  });

  it("sends update events only to the main window after isMainContents and senderAllowed", () => {
    const sends = [...main.matchAll(/([\w.]+)\.send\(BRIDGE_CHANNELS\.event/g)].map((m) => m[1]);
    expect(sends).toEqual(["mainWin.webContents"]);
    const at = main.indexOf("mainWin.webContents.send(BRIDGE_CHANNELS.event");
    const onEvent = main.slice(main.lastIndexOf("onEvent:", at), at);
    expect(onEvent).toContain("isMainContents(mainWin.webContents)");
    expect(onEvent).toContain("senderAllowed({ isMainWebContents: true, isMainFrame: true, url: mainWin.webContents.getURL() }, appList)");
  });

  it("starts in boot and stops in before-quit", () => {
    expect(main).toContain("updater.start()");
    expect(beforeQuitBody(main)).toContain("updater.stop()");
  });

  it("initCrashReporting runs before app.whenReady with @sentry/electron/main via require", () => {
    const init = main.indexOf("initCrashReporting(");
    expect(init).toBeGreaterThan(-1);
    expect(init).toBeLessThan(main.indexOf("app.whenReady()"));
    expect(main).toContain('require("@sentry/electron/main")');
    expect(main).not.toMatch(/import[^;]*from\s+["']@sentry\/electron/);
  });
});

describe("preloadApp.cts", () => {
  it("EVENT_TYPES includes update", () => {
    const line = preload.match(/const EVENT_TYPES = \[([^\]]*)\]/);
    expect(line?.[1]).toContain('"update"');
  });
});
