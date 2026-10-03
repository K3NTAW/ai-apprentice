// Permission, permission-check and display-media decisions for the main window. Electron-free.
import { isOriginAllowed, type Allowlist } from "./origin.mjs";

/** Origin of an http(s) URL without userinfo, else null. */
export function originOf(url: unknown): string | null {
  if (typeof url !== "string" || url === "") return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    if (u.username !== "" || u.password !== "") return null;
    return u.origin;
  } catch {
    return null;
  }
}

export function isUrlAllowed(url: unknown, list: Allowlist): boolean {
  const o = originOf(url);
  return o !== null && isOriginAllowed(o, list);
}

export type PermissionRequest = {
  permission: string;
  /** details.requestingUrl */
  url: string | undefined;
  isMainFrame: boolean;
  /** details.mediaTypes for 'media' */
  mediaTypes?: readonly string[];
  /** the request comes from the main window's webContents */
  fromMainWindow: boolean;
};

/** Microphone ('media' with audio only) and display-capture for the allowlisted main frame; everything else denied. */
export function grantPermission(req: PermissionRequest, list: Allowlist): boolean {
  if (!req.fromMainWindow || !req.isMainFrame || !isUrlAllowed(req.url, list)) return false;
  if (req.permission === "display-capture") return true;
  if (req.permission === "media") {
    const types = req.mediaTypes ?? [];
    return types.length > 0 && types.every((t) => t === "audio");
  }
  return false;
}

export type PermissionCheck = { permission: string; origin: string | undefined; mediaType?: string; fromMainWindow: boolean };

/** setPermissionCheckHandler: same rule, for the synchronous checks (media 'audio' only). */
export function checkPermission(c: PermissionCheck, list: Allowlist): boolean {
  if (!c.fromMainWindow || !isUrlAllowed(c.origin, list)) return false;
  if (c.permission === "display-capture") return true;
  if (c.permission === "media") return c.mediaType === "audio";
  return false;
}

export type DisplayMediaRequest = { url: string | undefined; isMainFrame: boolean; fromMainWindow: boolean; videoRequested: boolean };

export function allowDisplayMedia(req: DisplayMediaRequest, list: Allowlist): boolean {
  return req.fromMainWindow && req.isMainFrame && req.videoRequested && isUrlAllowed(req.url, list);
}

export type ScreenSource = { id: string; display_id: string; name: string };

/** The primary display's screen source; falls back to the first screen source. Windows are never picked. */
export function pickPrimarySource<T extends ScreenSource>(sources: readonly T[], primaryDisplayId: number): T | null {
  const screens = sources.filter((s) => s.id.startsWith("screen:"));
  return screens.find((s) => s.display_id === String(primaryDisplayId)) ?? screens[0] ?? null;
}

/** Options for session.setDisplayMediaRequestHandler: no OS picker. */
export const DISPLAY_MEDIA_OPTIONS = { useSystemPicker: false } as const;
