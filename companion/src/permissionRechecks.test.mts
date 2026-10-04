import { describe, expect, it, vi } from "vitest";
import { wirePermissionRechecks } from "./permissionRechecks.mjs";
import { RECHECK_EVENTS } from "./permissions.mjs";

/** Fake monitor and fake app: the injected event sources fire by hand. */
function wired(ready = true) {
  const handlers = new Map<string, () => void>();
  const app = { on: (ev: string, fn: () => void) => handlers.set(ev, fn), isReady: () => ready };
  const monitor = { check: vi.fn() };
  const rechecks = wirePermissionRechecks(monitor, app);
  return { handlers, monitor, rechecks };
}

const apis = (platform: NodeJS.Platform = "darwin") => ({
  platform,
  openExternal: vi.fn(async () => undefined),
  askForMicrophone: vi.fn(async () => false),
  touchScreenCapture: vi.fn(async () => []),
});

describe("permission re-check wiring", () => {
  it("app activate and focus events re-check, once the app is ready", () => {
    const w = wired();
    expect([...w.handlers.keys()]).toEqual([...RECHECK_EVENTS]);
    w.handlers.get("activate")!();
    w.handlers.get("did-become-active")!();
    w.handlers.get("browser-window-focus")!();
    expect(w.monitor.check).toHaveBeenCalledTimes(3);
    const early = wired(false);
    early.handlers.get("activate")!();
    expect(early.monitor.check).not.toHaveBeenCalled();
  });

  it("a session start re-checks; later session.state updates and the end do not", () => {
    const w = wired();
    expect(w.rechecks.session(null, "teach")).toBe(true);
    expect(w.monitor.check).toHaveBeenCalledTimes(1);
    expect(w.rechecks.session("teach", "teach")).toBe(false);
    expect(w.rechecks.session("teach", "capture")).toBe(false);
    expect(w.rechecks.session("capture", null)).toBe(false);
    expect(w.monitor.check).toHaveBeenCalledTimes(1);
    expect(w.rechecks.session(undefined, "capture")).toBe(true);
    expect(w.monitor.check).toHaveBeenCalledTimes(2);
  });

  it("openPermissionSettings re-checks after the pane opens, then runs the caller's follow-up", async () => {
    const w = wired();
    const order: string[] = [];
    w.monitor.check.mockImplementation(() => order.push("check"));
    const a = apis();
    a.openExternal.mockImplementation(async () => void order.push("open"));
    const r = await w.rechecks.openSettings("screen", a, () => order.push("status"));
    expect(r).toEqual({ ok: true, opened: expect.stringContaining("Privacy_ScreenCapture") });
    expect(order).toEqual(["open", "check", "status"]);
  });

  it("re-checks even when opening the pane fails; an unknown kind opens nothing and does not re-check", async () => {
    const w = wired();
    const a = apis();
    a.openExternal.mockRejectedValue(new Error("no handler"));
    await expect(w.rechecks.openSettings("accessibility", a)).rejects.toThrow("no handler");
    expect(w.monitor.check).toHaveBeenCalledTimes(1);
    expect(await w.rechecks.openSettings("camera", apis())).toEqual({ ok: false, reason: "unknown_kind" });
    expect(w.monitor.check).toHaveBeenCalledTimes(1);
  });
});
