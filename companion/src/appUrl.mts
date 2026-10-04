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

/** Supabase SSR session cookie: sb-<ref>-auth-token, or one of its chunks (.0, .1, ...). Not the PKCE code verifier. */
const SESSION_COOKIE = /^sb-[^.]+-auth-token(\.\d+)?$/;

export function hasAppSession(cookieNames: readonly string[]): boolean {
  return cookieNames.some((n) => SESSION_COOKIE.test(n));
}

/** The APP_URL as a base: its path kept with a trailing slash, query and hash dropped (https://x/app -> https://x/app/). */
function appBase(appUrl: string): URL {
  const url = new URL(appUrl);
  url.search = "";
  url.hash = "";
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url;
}

/**
 * The window opens straight into the product, never the marketing site: /agents when signed in, /login when not.
 * A sub-path in APP_URL is kept (https://x/app -> https://x/app/login), for an app served under that path.
 */
export function mainEntryUrl(appUrl: string, signedIn: boolean): string {
  return new URL(signedIn ? "agents" : "login", appBase(appUrl)).href;
}

/** No APP_URL anywhere: the local setup screen, nothing remote. Invalid: the local error page. */
export function planMainLoad(resolved: AppUrlResult, signedIn = false): MainLoad {
  if (resolved.ok) return { kind: "remote", url: mainEntryUrl(resolved.url, signedIn) };
  if (resolved.reason === "app_url_unset") return { kind: "setup" };
  return { kind: "error", reason: resolved.reason };
}

/** The parts of the main BrowserWindow that loading it needs (injected, so tests pass a fake window and session). */
export type MainWindowLike = {
  isDestroyed(): boolean;
  loadURL(url: string): unknown;
  loadFile(file: string, options?: { query?: Record<string, string> }): unknown;
  webContents: { session: { cookies: { get(filter: { url: string }): Promise<readonly { name: string }[]> } } };
};

/** A Supabase session cookie for the app origin in the window's session: signed in. Any failure counts as signed out. */
export async function signedInToApp(win: MainWindowLike, resolved: AppUrlResult): Promise<boolean> {
  if (!resolved.ok) return false;
  try {
    const cookies = await win.webContents.session.cookies.get({ url: resolved.origin });
    return hasAppSession(cookies.map((c) => c.name));
  } catch {
    return false;
  }
}

/**
 * Remote only with a valid APP_URL, and then straight into the product: /agents signed in, /login signed out (never
 * the marketing site). Otherwise a local page (setup screen or error page), nothing remote. Returns the plan.
 */
export async function loadMainWindow(win: MainWindowLike, resolved: AppUrlResult, files: { setup: string; error: string }): Promise<MainLoad | null> {
  const signedIn = await signedInToApp(win, resolved);
  if (win.isDestroyed()) return null;
  const plan = planMainLoad(resolved, signedIn);
  if (plan.kind === "remote") void win.loadURL(plan.url);
  else if (plan.kind === "setup") void win.loadFile(files.setup);
  else void win.loadFile(files.error, { query: { reason: plan.reason } });
  return plan;
}
