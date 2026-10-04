// window.apprentice.openPermissionSettings(kind): opens the system settings pane for one permission.
// Electron-free; main.mts passes shell.openExternal, systemPreferences and desktopCapturer.
// Only the fixed URLs below are ever opened: the page sends a kind, never a URL.

export const PERMISSION_KINDS = ["microphone", "screen", "accessibility", "input-monitoring"] as const;
export type PermissionKind = (typeof PERMISSION_KINDS)[number];

export const MAC_SETTINGS_URLS: Record<PermissionKind, string> = {
  microphone: "x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone",
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  "input-monitoring": "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
};

/** Windows asks only for the microphone; the other kinds have no setting there. */
export const WIN_SETTINGS_URLS: Partial<Record<PermissionKind, string>> = {
  microphone: "ms-settings:privacy-microphone",
};

export function isPermissionKind(v: unknown): v is PermissionKind {
  return typeof v === "string" && (PERMISSION_KINDS as readonly string[]).includes(v);
}

export type PermissionSettingsApis = {
  platform: NodeJS.Platform;
  openExternal(url: string): Promise<void> | void;
  /** systemPreferences.askForMediaAccess('microphone') (macOS). */
  askForMicrophone(): Promise<boolean>;
  /** desktopCapturer.getSources once: macOS shows the Screen Recording prompt the first time. */
  touchScreenCapture(): Promise<unknown>;
  /** Re-read the permissions and send a 'status' event. */
  refresh(): void;
};

export type PermissionSettingsResult =
  | { ok: true; opened: string | null; granted?: boolean }
  | { ok: false; reason: "unknown_kind" | "not_needed" | "unsupported_platform" };

export async function openPermissionSettings(kind: unknown, apis: PermissionSettingsApis): Promise<PermissionSettingsResult> {
  if (!isPermissionKind(kind)) return { ok: false, reason: "unknown_kind" };
  if (apis.platform === "win32") {
    const url = WIN_SETTINGS_URLS[kind];
    if (!url) return { ok: false, reason: "not_needed" };
    await apis.openExternal(url);
    return { ok: true, opened: url };
  }
  if (apis.platform !== "darwin") return { ok: false, reason: "unsupported_platform" };
  try {
    if (kind === "microphone") {
      // First time: the system prompt. Granted means there is nothing to fix in Settings.
      const granted = await apis.askForMicrophone().catch(() => false);
      if (granted) return { ok: true, opened: null, granted: true };
    } else if (kind === "screen") {
      await apis.touchScreenCapture().catch(() => undefined);
    }
    const url = MAC_SETTINGS_URLS[kind];
    await apis.openExternal(url);
    return { ok: true, opened: url };
  } finally {
    apis.refresh();
  }
}
