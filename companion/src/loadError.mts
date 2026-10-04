// Main window load failures: why the control room did not load, in plain words, and the local error page's
// view model. Electron-free.
import type { Allowlist } from "./origin.mjs";
import { isUrlAllowed, originOf } from "./permissionsGrant.mjs";

export type LoadFailure =
  | { kind: "blocked"; url: string }
  | { kind: "network"; code: number; description: string }
  | { kind: "crash"; reason: string };

export type LoadReason = { kind: "deployment-protection" | "redirect" | "network" | "crash"; message: string };

export type LoadErrorActionId = "retry" | "change-url" | "open-browser";
export const LOAD_ERROR_ACTIONS: readonly LoadErrorActionId[] = ["retry", "change-url", "open-browser"];

export type LoadErrorView = {
  title: string;
  reason: string;
  actions: { id: LoadErrorActionId; label: string }[];
};

/** Navigation guard for the main window: only the exact-origin allowlist may load. */
export function navigationAllowed(url: unknown, list: Allowlist): boolean {
  return isUrlAllowed(url, list);
}

/** Origin of a URL for logs and messages (never the path or query string). */
export function safeOrigin(url: unknown): string {
  const o = originOf(url);
  if (o !== null) return o;
  if (typeof url !== "string") return "unknown";
  try {
    const u = new URL(url);
    return u.protocol === "file:" ? "file://" : `${u.protocol}//${u.host}`;
  } catch {
    return "unknown";
  }
}

/** One stdout line per blocked navigation: the blocked origin, no path or query string. */
export function blockedNavigationLog(url: unknown): string {
  return `navigation blocked: ${safeOrigin(url)}`;
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

const NETWORK_HINTS: Record<string, string> = {
  ERR_INTERNET_DISCONNECTED: "This computer is offline.",
  ERR_NAME_NOT_RESOLVED: "The address could not be found. Check the URL.",
  ERR_CONNECTION_REFUSED: "The server refused the connection.",
  ERR_CONNECTION_TIMED_OUT: "The server did not answer in time.",
  ERR_TIMED_OUT: "The server did not answer in time.",
  ERR_CERT_AUTHORITY_INVALID: "The server's certificate is not trusted.",
  ERR_CERT_COMMON_NAME_INVALID: "The server's certificate does not match the address.",
};

/** Plain-words reason for a failed load. */
export function classifyLoadFailure(f: LoadFailure): LoadReason {
  if (f.kind === "blocked") {
    const host = hostOf(f.url) || safeOrigin(f.url);
    if (host === "vercel.com" || host.endsWith(".vercel.com")) {
      return {
        kind: "deployment-protection",
        message: `The page redirected to ${host}: the deployment is protected by Vercel sign-in. Turn off Deployment Protection for previews or use the production URL.`,
      };
    }
    return { kind: "redirect", message: `The page redirected to ${host}, which the app does not open.` };
  }
  if (f.kind === "network") {
    const code = f.description.trim() || `error ${f.code}`;
    const hint = NETWORK_HINTS[code.replace(/^net::/, "")] ?? "Check your connection and the URL.";
    return { kind: "network", message: `Network error (${code}). ${hint}` };
  }
  return { kind: "crash", message: `The page stopped unexpectedly (${f.reason || "unknown"}).` };
}

/** What the local error page shows: the app origin, the reason and the three actions. */
export function loadErrorView(appUrl: string | null, f: LoadFailure): LoadErrorView {
  const origin = appUrl ? safeOrigin(appUrl) : "the configured URL";
  return {
    title: `Couldn't load AI Apprentice from ${origin}.`,
    reason: classifyLoadFailure(f).message,
    actions: [
      { id: "retry", label: "Retry" },
      { id: "change-url", label: "Change URL" },
      { id: "open-browser", label: "Open in browser" },
    ],
  };
}

export function isLoadErrorAction(v: unknown): v is LoadErrorActionId {
  return typeof v === "string" && (LOAD_ERROR_ACTIONS as readonly string[]).includes(v);
}
