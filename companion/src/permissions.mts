// Permission status from the macOS permission APIs. Pure: main.mts passes Electron's systemPreferences.
import type { Permissions } from "./protocol.mjs";

export type InputMonitoringStatus = "granted" | "denied" | "unknown";

export type PermissionApis = {
  platform: NodeJS.Platform;
  /** systemPreferences.isTrustedAccessibilityClient(false): never prompts. */
  isTrustedAccessibilityClient(prompt: boolean): boolean;
  /** systemPreferences.getMediaAccessStatus('screen'). */
  getMediaAccessStatus(type: "screen"): string;
  /** Input Monitoring status where a query is available (IOHIDCheckAccess). Electron has none today. */
  inputMonitoringStatus?: () => InputMonitoringStatus;
  /** True once the input hook has delivered at least one event since launch. */
  hookEventSeen?: () => boolean;
};

/**
 * input: Accessibility is trusted and Input Monitoring is granted. Where Input Monitoring cannot be
 * queried (Electron today), input is true only after the hook has delivered at least one event since
 * launch. inputVerified: the input value is backed by a query result or an observed event.
 */
export function readPermissions(api: PermissionApis): Permissions {
  if (api.platform !== "darwin") return { input: true, screen: true, accessibility: true, inputVerified: true };
  const accessibility = api.isTrustedAccessibilityClient(false) === true;
  const screen = api.getMediaAccessStatus("screen") === "granted";
  const monitoring = api.inputMonitoringStatus?.() ?? "unknown";
  const seen = api.hookEventSeen?.() === true;
  const inputVerified = monitoring !== "unknown" || seen;
  const monitoringOk = monitoring === "granted" || (monitoring === "unknown" && seen);
  return { input: accessibility && monitoringOk, screen, accessibility, inputVerified };
}

/** The hook needs Accessibility; it is started without a known Input Monitoring grant so the first event can verify it. */
export function canStartHook(api: PermissionApis): boolean {
  if (api.platform !== "darwin") return true;
  return api.isTrustedAccessibilityClient(false) === true && api.inputMonitoringStatus?.() !== "denied";
}

/** Emits once on start() and then only when the permission set changes. */
export class PermissionMonitor {
  private last = "";
  constructor(
    private readonly read: () => Permissions,
    private readonly onChange: (p: Permissions) => void,
  ) {}

  start(): Permissions {
    this.last = "";
    return this.check();
  }

  check(): Permissions {
    const p = this.read();
    const key = JSON.stringify(p);
    if (key !== this.last) {
      this.last = key;
      this.onChange(p);
    }
    return p;
  }
}
