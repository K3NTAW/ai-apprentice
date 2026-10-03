import { describe, expect, it, vi } from "vitest";
import { canStartHook, PermissionMonitor, readPermissions, type PermissionApis } from "./permissions.mjs";
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
    expect(sent[0].permissions).toEqual({ input: true, screen: true, accessibility: true, inputVerified: true });
    expect(api.isTrustedAccessibilityClient).toHaveBeenCalledWith(false);
    expect(api.getMediaAccessStatus).toHaveBeenCalledWith("screen");
  });

  it("input is false when Accessibility is not trusted", () => {
    const p = readPermissions(apis({ isTrustedAccessibilityClient: () => false, getMediaAccessStatus: () => "denied" }));
    expect(p).toEqual({ input: false, screen: false, accessibility: false, inputVerified: false });
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
    expect(sent[0].permissions).toEqual({ input: false, screen: true, accessibility: true, inputVerified: false });
    // The hook still starts so the first event can verify Input Monitoring.
    expect(canStartHook(api)).toBe(true);
    monitor.check();
    expect(sent).toHaveLength(1);
    seen = true;
    monitor.check();
    expect(sent).toHaveLength(2);
    expect(sent[1].permissions).toEqual({ input: true, screen: true, accessibility: true, inputVerified: true });
    expect(Object.keys(sent[1]).sort()).toEqual(["permissions", "type", "version"]);
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
