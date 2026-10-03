import { describe, expect, it, vi } from "vitest";
import { PermissionMonitor, readPermissions, type PermissionApis } from "./permissions.mjs";
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
  it("reports input right after launch from the APIs, with no input event observed", () => {
    const api = apis();
    const sent: ReturnType<typeof statusMessage>[] = [];
    const monitor = new PermissionMonitor(() => readPermissions(api), (p) => sent.push(statusMessage("0.1.0", p)));
    monitor.start();
    expect(sent).toHaveLength(1);
    expect(sent[0].permissions).toEqual({ input: true, screen: true, accessibility: true });
    expect(api.isTrustedAccessibilityClient).toHaveBeenCalledWith(false);
    expect(api.getMediaAccessStatus).toHaveBeenCalledWith("screen");
  });

  it("input is false when Accessibility is not trusted", () => {
    const p = readPermissions(apis({ isTrustedAccessibilityClient: () => false, getMediaAccessStatus: () => "denied" }));
    expect(p).toEqual({ input: false, screen: false, accessibility: false });
  });

  it("uses the Input Monitoring status where available", () => {
    expect(readPermissions(apis({ inputMonitoringStatus: () => "denied" })).input).toBe(false);
    expect(readPermissions(apis({ inputMonitoringStatus: () => "granted" })).input).toBe(true);
    expect(readPermissions(apis({ inputMonitoringStatus: () => "unknown" })).input).toBe(true);
  });

  it("emits status only on change", () => {
    let trusted = false;
    const seen: Permissions[] = [];
    const monitor = new PermissionMonitor(() => readPermissions(apis({ isTrustedAccessibilityClient: () => trusted })), (p) => seen.push(p));
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
