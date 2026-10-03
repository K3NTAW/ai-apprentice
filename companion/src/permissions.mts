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
};

/**
 * input: Accessibility is trusted and Input Monitoring is not known to be denied. Without an
 * Input Monitoring query, Accessibility is the gate (uiohook needs it to start). Never derived from
 * observed input events.
 */
export function readPermissions(api: PermissionApis): Permissions {
  if (api.platform !== "darwin") return { input: true, screen: true, accessibility: true };
  const accessibility = api.isTrustedAccessibilityClient(false) === true;
  const screen = api.getMediaAccessStatus("screen") === "granted";
  const monitoring = api.inputMonitoringStatus?.() ?? "unknown";
  return { input: accessibility && monitoring !== "denied", screen, accessibility };
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
