import { describe, expect, it, vi } from "vitest";
import { canStartHook, PermissionMonitor, readPermissions, RECHECK_EVENTS, recheckOnActivate, sessionStarted, type PermissionApis } from "./permissions.mjs";
import { statusMessage, type Permissions } from "./protocol.mjs";

function apis(over: Partial<PermissionApis> = {}): PermissionApis {
  return {
    platform: "darwin",
    isTrustedAccessibilityClient: vi.fn(() => true),
    getMediaAccessStatus: vi.fn(() => "granted"),
    ...over,
  };
}

describe("permission status from macOS permission APIs", () => {
  it("reports input right after launch from the APIs when Input Monitoring is granted", () => {
    const api = apis({ inputMonitoringStatus: () => "granted" });
    const sent: ReturnType<typeof statusMessage>[] = [];
    const monitor = new PermissionMonitor(() => readPermissions(api), (p) => sent.push(statusMessage("0.1.0", p)));
    monitor.start();
    expect(sent).toHaveLength(1);
    expect(sent[0].permissions).toEqual({ input: true, screen: true, accessibility: true, inputVerified: true, microphone: true });
    expect(api.isTrustedAccessibilityClient).toHaveBeenCalledWith(false);
    expect(api.getMediaAccessStatus).toHaveBeenCalledWith("screen");
  });

  it("input is false when Accessibility is not trusted", () => {
    const p = readPermissions(apis({ isTrustedAccessibilityClient: () => false, getMediaAccessStatus: () => "denied" }));
    expect(p).toEqual({ input: false, screen: false, accessibility: false, inputVerified: false, microphone: false });
  });

  it("uses the Input Monitoring status where available", () => {
    expect(readPermissions(apis({ inputMonitoringStatus: () => "denied" })).input).toBe(false);
    expect(readPermissions(apis({ inputMonitoringStatus: () => "granted" })).input).toBe(true);
    expect(readPermissions(apis({ inputMonitoringStatus: () => "unknown" })).input).toBe(false);
  });

  it("without an Input Monitoring query reports input only after the first hook event", () => {
    let seen = false;
    const api = apis({ hookEventSeen: () => seen });
    const sent: ReturnType<typeof statusMessage>[] = [];
    const monitor = new PermissionMonitor(() => readPermissions(api), (p) => sent.push(statusMessage("0.1.0", p)));
    monitor.start();
    expect(sent[0].permissions).toEqual({ input: false, screen: true, accessibility: true, inputVerified: false, microphone: true });
    // The hook still starts so the first event can verify Input Monitoring.
    expect(canStartHook(api)).toBe(true);
    monitor.check();
    expect(sent).toHaveLength(1);
    seen = true;
    monitor.check();
    expect(sent).toHaveLength(2);
    expect(sent[1].permissions).toEqual({ input: true, screen: true, accessibility: true, inputVerified: true, microphone: true });
    expect(Object.keys(sent[1]).sort()).toEqual(["permissions", "protocol", "type", "version"]);
  });

  it("an observed event does not override missing Accessibility or a denied Input Monitoring query", () => {
    const seen = () => true;
    expect(readPermissions(apis({ hookEventSeen: seen, isTrustedAccessibilityClient: () => false })).input).toBe(false);
    expect(readPermissions(apis({ hookEventSeen: seen, inputMonitoringStatus: () => "denied" }))).toMatchObject({
      input: false,
      inputVerified: true,
    });
    expect(canStartHook(apis({ inputMonitoringStatus: () => "denied" }))).toBe(false);
    expect(canStartHook(apis({ isTrustedAccessibilityClient: () => false }))).toBe(false);
  });

  it("emits status only on change", () => {
    let trusted = false;
    const seen: Permissions[] = [];
    const monitor = new PermissionMonitor(
      () => readPermissions(apis({ isTrustedAccessibilityClient: () => trusted, inputMonitoringStatus: () => "granted" })),
      (p) => seen.push(p),
    );
    monitor.start();
    monitor.check();
    expect(seen).toHaveLength(1);
    expect(seen[0].input).toBe(false);
    trusted = true;
    monitor.check();
    monitor.check();
    expect(seen).toHaveLength(2);
    expect(seen[1]).toMatchObject({ input: true, accessibility: true });
  });
});

describe("permission re-check", () => {
  /** Fake app: a permission revoked after launch, noticed only when a re-check runs. */
  function revoked() {
    let screen = "granted";
    const changes: Permissions[] = [];
    const monitor = new PermissionMonitor(() => readPermissions(apis({ getMediaAccessStatus: () => screen })), (p) => changes.push(p));
    monitor.start();
    return { monitor, changes, revoke: () => (screen = "denied") };
  }

  it("re-checks when the app becomes active or a window gets focus", () => {
    const handlers = new Map<string, () => void>();
    const app = { on: (ev: string, fn: () => void) => handlers.set(ev, fn) };
    const r = revoked();
    recheckOnActivate(app, () => r.monitor.check());
    expect([...handlers.keys()]).toEqual([...RECHECK_EVENTS]);
    expect(handlers.has("activate")).toBe(true);
    expect(handlers.has("browser-window-focus")).toBe(true);
    r.revoke();
    expect(r.changes).toHaveLength(1);
    handlers.get("activate")!();
    expect(r.changes).toHaveLength(2);
    expect(r.changes[1].screen).toBe(false);
    // Unchanged on the next focus: no new emit.
    handlers.get("browser-window-focus")!();
    expect(r.changes).toHaveLength(2);
  });

  it("re-checks when a session starts, not on every session.state", () => {
    expect(sessionStarted(null, "teach")).toBe(true);
    expect(sessionStarted(undefined, "capture")).toBe(true);
    expect(sessionStarted("teach", "teach")).toBe(false);
    expect(sessionStarted("capture", "teach")).toBe(false);
    expect(sessionStarted(null, null)).toBe(false);
    const r = revoked();
    r.revoke();
    let mode: "capture" | "teach" | null = null;
    for (const next of ["teach", "teach"] as const) {
      if (sessionStarted(mode, next)) r.monitor.check();
      mode = next;
    }
    expect(r.changes.map((p) => p.screen)).toEqual([true, false]);
  });
});

describe("microphone status", () => {
  it("macOS: granted only when the OS says granted, read from the 'microphone' media type", () => {
    const api = apis({ getMediaAccessStatus: vi.fn((t: string) => (t === "microphone" ? "not-determined" : "granted")) });
    expect(readPermissions(api).microphone).toBe(false);
    expect(api.getMediaAccessStatus).toHaveBeenCalledWith("microphone");
    expect(readPermissions(apis()).microphone).toBe(true);
  });

  it("Windows: true unless the OS reports denied; other platforms are unknown", () => {
    expect(readPermissions(apis({ platform: "win32", getMediaAccessStatus: () => "granted" })).microphone).toBe(true);
    expect(readPermissions(apis({ platform: "win32", getMediaAccessStatus: () => "unknown" })).microphone).toBe(true);
    expect(readPermissions(apis({ platform: "win32", getMediaAccessStatus: () => "denied" })).microphone).toBe(false);
    expect(readPermissions(apis({ platform: "linux" })).microphone).toBe("unknown");
  });

  it("a change is emitted on the next check (activate, session start or after the settings action)", () => {
    let mic = "denied";
    const api = apis({ getMediaAccessStatus: (t: string) => (t === "microphone" ? mic : "granted") });
    const sent: ReturnType<typeof statusMessage>[] = [];
    const monitor = new PermissionMonitor(() => readPermissions(api), (p) => sent.push(statusMessage("0.1.0", p)));
    monitor.start();
    monitor.check();
    expect(sent).toHaveLength(1);
    expect(sent[0].permissions.microphone).toBe(false);
    mic = "granted";
    monitor.check();
    expect(sent).toHaveLength(2);
    expect(sent[1].permissions.microphone).toBe(true);
  });

  it("status carries microphone only when boolean or 'unknown'", () => {
    const base = { input: true, screen: true, accessibility: true };
    expect(statusMessage("1", { ...base, microphone: "unknown" }).permissions.microphone).toBe("unknown");
    expect(statusMessage("1", { ...base, microphone: true }).permissions.microphone).toBe(true);
    expect("microphone" in statusMessage("1", base).permissions).toBe(false);
    expect("microphone" in statusMessage("1", { ...base, microphone: "yes" as never }).permissions).toBe(false);
  });
});
