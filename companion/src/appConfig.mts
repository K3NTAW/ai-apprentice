// APP_URL resolution, the main window's origin allowlist and the COMPANION_WS switch. Electron-free.
import { buildAllowlist, compileRule, type Allowlist } from "./origin.mjs";

export const PRODUCT_NAME = "AI Apprentice";
export const MAX_APP_URL_LENGTH = 2048;
/**
 * userData stays where the companion kept it before the rename (settings, dock prefs, window state),
 * so a renamed build keeps its files. Dev runs use the package name, packaged builds the old productName.
 */
export const LEGACY_USER_DATA_DIR = { packaged: "AI Apprentice Companion", dev: "ai-apprentice-companion" } as const;

export type AppUrlResult = { ok: true; url: string; origin: string } | { ok: false; reason: string };

/** The local WebSocket server (and the pairing flow) runs only with COMPANION_WS=1. */
export function wsEnabled(env: Record<string, string | undefined>): boolean {
  return env.COMPANION_WS === "1";
}

export function userDataDirName(isPackaged: boolean): string {
  return isPackaged ? LEGACY_USER_DATA_DIR.packaged : LEGACY_USER_DATA_DIR.dev;
}

/** https only (http only for localhost / 127.0.0.1), no userinfo. Returns the normalised URL and origin. */
export function validateAppUrl(raw: unknown): AppUrlResult {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "app_url_missing" };
  if (raw.length > MAX_APP_URL_LENGTH) return { ok: false, reason: "app_url_too_long" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "app_url_invalid" };
  }
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "app_url_userinfo" };
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return { ok: false, reason: "app_url_scheme" };
  if (compileRule(url.origin) === null) return { ok: false, reason: "app_url_host" };
  return { ok: true, url: url.href, origin: url.origin };
}

/** companion/app.config.json: {"appUrl": "https://..." | null}. Missing, null or corrupt means no value. */
export function parseAppConfig(text: string | null): { appUrl?: string } {
  if (text === null) return {};
  try {
    const data: unknown = JSON.parse(text);
    if (data && typeof data === "object" && typeof (data as { appUrl?: unknown }).appUrl === "string") {
      return { appUrl: (data as { appUrl: string }).appUrl };
    }
  } catch {
    // corrupt file: ignored
  }
  return {};
}

/**
 * APP_URL (env) wins, then app.config.json, then the URL stored by the setup screen (userData). There is
 * no built-in default: nothing set is 'app_url_unset' (the main window shows the local setup screen).
 * An invalid value is an error (the app shows an error page), never a silent fallback.
 */
export function resolveAppUrl(opts: { env: string | undefined; configText: string | null; storedText: string | null }): AppUrlResult {
  if (opts.env !== undefined && opts.env.trim() !== "") return validateAppUrl(opts.env);
  const configured = parseAppConfig(opts.configText).appUrl;
  if (configured !== undefined && configured.trim() !== "") return validateAppUrl(configured);
  const stored = parseAppConfig(opts.storedText).appUrl;
  if (stored !== undefined && stored.trim() !== "") return validateAppUrl(stored);
  return { ok: false, reason: "app_url_unset" };
}

/**
 * The origins the main window may load and that get the bridge, microphone and screen capture: exactly the
 * APP_URL origin, http://localhost:3000 only when unpackaged, plus exact COMPANION_ALLOWED_ORIGINS entries.
 */
export function appAllowlist(opts: { appOrigin: string | null; isPackaged: boolean; env: string | undefined }): Allowlist {
  return buildAllowlist(opts);
}
