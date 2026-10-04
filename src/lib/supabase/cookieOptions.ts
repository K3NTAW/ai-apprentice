// Supabase session cookies outlive the browser (T-0255): every client (browser, server, proxy) passes these options,
// and the proxy also stamps a max-age on any cookie the SSR client hands it without one, so no auth cookie is ever a
// session-only cookie that a browser or Electron restart drops. A removal (max-age 0 or empty value) is left alone.
import type { CookieOptions } from "@supabase/ssr";

/** 400 days, the longest lifetime browsers accept (RFC 6265bis); the refresh token rotation keeps the session fresh. */
export const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

export function sessionCookieOptions(): CookieOptions {
  return { path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production", maxAge: SESSION_COOKIE_MAX_AGE };
}

/** The options a response should use for this cookie: unchanged when it already has a lifetime or is a removal. */
export function persistentCookie(value: string, options: CookieOptions = {}): CookieOptions {
  if (!value || options.maxAge !== undefined || options.expires !== undefined) return options;
  return { ...options, maxAge: SESSION_COOKIE_MAX_AGE };
}
