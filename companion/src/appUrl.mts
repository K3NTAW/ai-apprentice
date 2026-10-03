// app_url check for 'Open control room', the first-run setup URL and what the main window loads. Pure.
import type { AppUrlResult } from "./appConfig.mjs";
import { compileRule, isOriginAllowed, type Allowlist } from "./origin.mjs";

export const MAX_APP_URL = 2048;

/**
 * new URL(raw); scheme https (http only for localhost / 127.0.0.1); no userinfo; the origin must match
 * the single exact-origin allowlist. Returns the normalised href to open.
 */
export function checkAppUrl(raw: unknown, allowlist: Allowlist): { ok: true; href: string } | { ok: false; reason: string } {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > MAX_APP_URL) return { ok: false, reason: "app_url_missing" };
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return { ok: false, reason: "app_url_invalid" };
  }
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "app_url_userinfo" };
  const local = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (url.protocol !== "https:" && !(url.protocol === "http:" && local)) return { ok: false, reason: "app_url_scheme" };
  if (!isOriginAllowed(url.origin, allowlist)) return { ok: false, reason: "app_url_origin" };
  return { ok: true, href: url.href };
}

/** File in userData that holds the URL pasted on the setup screen. */
export const STORED_APP_URL_FILE = "app-url.json";

/**
 * The setup screen's 'Paste your AI Apprentice URL': https only (no http, not even localhost), no userinfo,
 * a plain host. Returns the normalised URL and origin to store.
 */
export function validateSetupUrl(raw: unknown): AppUrlResult {
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, reason: "app_url_missing" };
  if (raw.length > MAX_APP_URL) return { ok: false, reason: "app_url_too_long" };
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "app_url_invalid" };
  }
  if (url.protocol !== "https:") return { ok: false, reason: "app_url_scheme" };
  if (url.username !== "" || url.password !== "") return { ok: false, reason: "app_url_userinfo" };
  if (compileRule(url.origin) === null) return { ok: false, reason: "app_url_host" };
  return { ok: true, url: url.href, origin: url.origin };
}

export function serializeStoredAppUrl(url: string): string {
  return JSON.stringify({ appUrl: url }) + "\n";
}

export type MainLoad = { kind: "remote"; url: string } | { kind: "setup" } | { kind: "error"; reason: string };

/** No APP_URL anywhere: the local setup screen, nothing remote. Invalid: the local error page. */
export function planMainLoad(resolved: AppUrlResult): MainLoad {
  if (resolved.ok) return { kind: "remote", url: resolved.url };
  if (resolved.reason === "app_url_unset") return { kind: "setup" };
  return { kind: "error", reason: resolved.reason };
}
