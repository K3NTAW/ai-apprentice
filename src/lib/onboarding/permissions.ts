// Desktop permission rows for the onboarding step, from the bridge 'status' event (window.apprentice).
// The status payload reports screen, accessibility and input (Input Monitoring). It has no microphone field: the
// row reads permissions.microphone when a newer app sends it and shows 'unknown' otherwise (never a false check).
export const PERMISSION_KINDS = ["microphone", "screen", "accessibility", "input-monitoring"] as const;
export type PermissionKind = (typeof PERMISSION_KINDS)[number];
export type PermissionValue = "granted" | "missing" | "unknown";
export type PermissionRow = { kind: PermissionKind; label: string; why: string; value: PermissionValue };

const ROWS: Array<Omit<PermissionRow, "value"> & { field: string }> = [
  { kind: "microphone", field: "microphone", label: "Microphone", why: "So the agent hears your answers when you talk." },
  { kind: "screen", field: "screen", label: "Screen recording", why: "So the agent sees the steps you take." },
  { kind: "accessibility", field: "accessibility", label: "Accessibility", why: "So the cursor buddy can point at the right place." },
  { kind: "input-monitoring", field: "input", label: "Input monitoring", why: "So the agent knows when you type and pause." },
];

export const RESTART_NOTE = "macOS may need the app restarted after you grant a permission.";

export function permissionRows(status: unknown): PermissionRow[] {
  const perms = (status as { type?: unknown; permissions?: Record<string, unknown> } | null)?.permissions;
  return ROWS.map(({ field, ...row }) => {
    const v = perms?.[field];
    return { ...row, value: v === true ? "granted" : v === false ? "missing" : "unknown" };
  });
}

type GrantResult = { ok: boolean; opened?: string | null; granted?: boolean; reason?: string };
export type DesktopBridge = {
  on(type: string, handler: (msg: unknown) => void): () => void;
  window(action: string): void;
  openPermissionSettings?(kind: string): Promise<GrantResult>;
  /** Window actions this app accepts (newer apps); 'relaunch' enables the Restart app action. */
  windowActions?: readonly string[];
};

/** window.apprentice when it is the desktop bridge, else null (the browser). */
export function desktopBridge(win: unknown = typeof window === "undefined" ? undefined : window): DesktopBridge | null {
  const b = (win as { apprentice?: Partial<DesktopBridge> } | undefined)?.apprentice;
  return b && typeof b.on === "function" && typeof b.window === "function" ? (b as DesktopBridge) : null;
}

export async function grantPermission(bridge: DesktopBridge, kind: PermissionKind): Promise<GrantResult> {
  if (typeof bridge.openPermissionSettings !== "function") return { ok: false, reason: "unsupported" };
  try {
    return await bridge.openPermissionSettings(kind);
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export const canRelaunch = (bridge: DesktopBridge | null) => Boolean(bridge?.windowActions?.includes("relaunch"));

export function relaunchApp(bridge: DesktopBridge): boolean {
  if (!canRelaunch(bridge)) return false;
  bridge.window("relaunch");
  return true;
}
