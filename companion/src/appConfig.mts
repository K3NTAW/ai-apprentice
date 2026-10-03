// APP_URL resolution, the main window's origin allowlist and the COMPANION_WS switch. Electron-free.
import { compileRule, DEFAULT_ALLOWED_ORIGINS, parseAllowlist, type Allowlist, type OriginRule } from "./origin.mjs";

export const PRODUCT_NAME = "AI Apprentice";
export const DEV_APP_URL = "http://localhost:3000";
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

/** companion/app.config.json: {"appUrl": "https://..."}. A missing or corrupt file means no value. */
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
 * APP_URL (env) wins. Otherwise packaged builds use app.config.json and dev runs use localhost:3000.
 * An invalid value is an error (the app shows an error page), never a silent fallback.
 */
export function resolveAppUrl(opts: { env: string | undefined; configText: string | null; isPackaged: boolean }): AppUrlResult {
  if (opts.env !== undefined && opts.env !== "") return validateAppUrl(opts.env);
  if (!opts.isPackaged) return validateAppUrl(DEV_APP_URL);
  return validateAppUrl(parseAppConfig(opts.configText).appUrl);
}

/**
 * The origins the main window may load and that get the bridge, microphone and screen capture.
 * Packaged: the APP_URL origin only. Dev: also localhost:3000 and the Vercel preview patterns.
 * COMPANION_ALLOWED_ORIGINS adds entries in both (explicit opt-in).
 */
export function appAllowlist(opts: { appOrigin: string; isPackaged: boolean; env: string | undefined }): Allowlist {
  const rules: OriginRule[] = [];
  const errors: string[] = [];
  const add = (entry: string) => {
    const r = compileRule(entry);
    if (r) rules.push(r);
    else errors.push(`invalid origin rule ignored: ${entry}`);
  };
  add(opts.appOrigin);
  if (!opts.isPackaged) for (const e of DEFAULT_ALLOWED_ORIGINS) add(e);
  if (opts.env !== undefined && opts.env.trim() !== "") {
    const extra = parseAllowlist(opts.env);
    rules.push(...extra.rules);
    errors.push(...extra.errors);
  }
  return { rules, errors };
}
