import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createUpdater, readUpdatesFlag, type AutoUpdaterLike, type UpdateEvent } from "./updater.mjs";

class FakeAutoUpdater extends EventEmitter implements AutoUpdaterLike {
  logger: unknown = console;
  autoDownload = false;
  autoInstallOnAppQuit = false;
  checks = 0;
  result: () => Promise<unknown> = () => Promise.resolve(null);
  checkForUpdates() {
    this.checks++;
    return this.result();
  }
}

function harness(over: { intervalMs?: number } = {}) {
  const au = new FakeAutoUpdater();
  const debug = vi.fn();
  const events: UpdateEvent[] = [];
  const unref = vi.fn();
  const set = vi.fn((fn: () => void, ms: number) => {
    const h = setInterval(fn, ms);
    return { unref, h };
  });
  const clear = vi.fn((h: unknown) => clearInterval((h as { h: ReturnType<typeof setInterval> }).h));
  const updater = createUpdater({
    autoUpdater: au,
    enabled: true,
    intervalMs: over.intervalMs ?? 1000,
    log: { debug },
    onEvent: (e) => events.push(e),
    setInterval: set,
    clearInterval: clear,
  });
  return { au, debug, events, unref, set, clear, updater };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe("readUpdatesFlag", () => {
  it.each([
    ['{"updates":true}', true],
    ['{"appUrl":null,"updates":true}', true],
    [null, false],
    ["", false],
    ['{"appUrl":null}', false],
    ['{"updates":false}', false],
    ['{"updates":null}', false],
    ['{"updates":"true"}', false],
    ["true", false],
    ["[true]", false],
    ["{not json", false],
  ])("%s -> %s", (text, want) => {
    expect(readUpdatesFlag(text)).toBe(want);
  });
});

describe("createUpdater", () => {
  it("disabled never reads a property of autoUpdater", () => {
    const trap = new Proxy({} as AutoUpdaterLike, {
      get: () => {
        throw new Error("touched");
      },
      set: () => {
        throw new Error("touched");
      },
    });
    const set = vi.fn();
    const u = createUpdater({ autoUpdater: trap, enabled: false, log: { debug: vi.fn() }, onEvent: vi.fn(), setInterval: set, clearInterval: vi.fn() });
    expect(() => {
      u.start();
      u.stop();
    }).not.toThrow();
    expect(set).not.toHaveBeenCalled();
  });

  it("enabled: logger null, autoDownload and autoInstallOnAppQuit true", () => {
    const { au, updater } = harness();
    updater.start();
    expect(au.logger).toBeNull();
    expect(au.autoDownload).toBe(true);
    expect(au.autoInstallOnAppQuit).toBe(true);
    updater.stop();
  });

  it("registers the error listener before the first check", () => {
    const { au, updater } = harness();
    let listenersAtCheck = -1;
    au.result = () => {
      listenersAtCheck = au.listenerCount("error");
      return Promise.resolve(null);
    };
    updater.start();
    return vi.waitFor(() => expect(listenersAtCheck).toBe(1)).finally(() => updater.stop());
  });

  it("checks at start and every intervalMs with an unref'd interval; stop clears it", async () => {
    const { au, unref, set, clear, updater } = harness({ intervalMs: 1000 });
    updater.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(au.checks).toBe(1);
    expect(set).toHaveBeenCalledWith(expect.any(Function), 1000);
    expect(unref).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(au.checks).toBe(2);
    await vi.advanceTimersByTimeAsync(2000);
    expect(au.checks).toBe(4);
    updater.stop();
    expect(clear).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5000);
    expect(au.checks).toBe(4);
  });

  it("default intervalMs is 6 h", async () => {
    const au = new FakeAutoUpdater();
    const set = vi.fn(() => ({ unref: vi.fn() }));
    createUpdater({ autoUpdater: au, enabled: true, log: { debug: vi.fn() }, onEvent: vi.fn(), setInterval: set, clearInterval: vi.fn() }).start();
    expect(set).toHaveBeenCalledWith(expect.any(Function), 6 * 60 * 60 * 1000);
  });

  it("a rejected check is logged once at debug and never throws", async () => {
    const { au, debug, updater } = harness();
    au.result = () => Promise.reject(new Error("net::ERR_INTERNET_DISCONNECTED"));
    expect(() => updater.start()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(debug).toHaveBeenCalledTimes(1);
    expect(debug).toHaveBeenCalledWith("updater.check_failed reason=Error: net::ERR_INTERNET_DISCONNECTED");
    updater.stop();
  });

  it("a synchronously throwing check is logged and never throws", async () => {
    const { au, debug, updater } = harness();
    au.result = () => {
      throw new TypeError("boom");
    };
    expect(() => updater.start()).not.toThrow();
    await vi.advanceTimersByTimeAsync(0);
    expect(debug).toHaveBeenCalledWith("updater.check_failed reason=TypeError: boom");
    updater.stop();
  });

  it("an emitted error does not throw and is logged at debug", () => {
    const { au, debug, updater } = harness();
    updater.start();
    expect(() => au.emit("error", new Error("No published versions on GitHub"))).not.toThrow();
    expect(debug).toHaveBeenCalledWith("updater.error reason=Error: No published versions on GitHub");
    updater.stop();
  });

  it("maps available and downloaded, deduped per state and version", () => {
    const { au, events, updater } = harness();
    updater.start();
    au.emit("update-available", { version: "1.2.0" });
    au.emit("update-available", { version: "1.2.0" });
    au.emit("update-downloaded", { version: "1.2.0" });
    au.emit("update-downloaded", { version: "1.2.0" });
    au.emit("update-available", { version: "1.3.0" });
    expect(events).toEqual([
      { type: "update", state: "available", version: "1.2.0" },
      { type: "update", state: "downloaded", version: "1.2.0" },
      { type: "update", state: "available", version: "1.3.0" },
    ]);
    updater.stop();
  });
});
