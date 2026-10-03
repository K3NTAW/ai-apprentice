// app_url check for 'Open control room'. Pure: the URL is opened only when this returns ok.
import { isOriginAllowed, type Allowlist } from "./origin.mjs";

export const MAX_APP_URL = 2048;

/**
 * new URL(raw); scheme https (http only for localhost / 127.0.0.1); no userinfo; the origin must match
 * the same allowlist that admits WebSocket clients. Returns the normalised href to open.
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
