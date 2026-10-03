// Validates a post-login redirect target. Only same-origin relative paths pass;
// anything else falls back. Used by the proxy, the login page and the auth callback.
const BASE = "http://internal.invalid";
const BLOCKED_FIRST_SEGMENTS = new Set(["login", "auth"]);

export function safeNext(input: unknown, fallback = "/capture"): string {
  if (typeof input !== "string") return fallback;
  if (input.length < 1 || input.length > 2048) return fallback;
  if (input[0] !== "/" || input[1] === "/" || input[1] === "\\") return fallback;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    if (c <= 0x20 || c === 0x7f || c === 0x5c) return fallback;
  }
  let url: URL;
  try {
    url = new URL(input, BASE);
  } catch {
    return fallback;
  }
  if (url.origin !== BASE) return fallback;
  // First segment of the parsed pathname, so '?' and '#' never count.
  const first = url.pathname.split("/")[1] ?? "";
  let decoded = first;
  try {
    decoded = decodeURIComponent(first);
  } catch {
    return fallback;
  }
  if (BLOCKED_FIRST_SEGMENTS.has(first.toLowerCase()) || BLOCKED_FIRST_SEGMENTS.has(decoded.toLowerCase())) {
    return fallback;
  }
  return input;
}

// Error codes the auth callback puts on /login?error=. The login page shows only these fixed texts.
export type LoginErrorCode = "missing_code" | "link_invalid" | "workspace_setup_failed";

const LOGIN_ERRORS: Record<LoginErrorCode, string> = {
  missing_code: "The sign-in link was incomplete. Request a new link.",
  link_invalid:
    "The sign-in link is invalid or has expired. Open it in the same browser you requested it from, or request a new link.",
  workspace_setup_failed: "Signed in, but your workspace could not be set up. Try again or contact the workspace owner.",
};

/** Fixed message for a known code, else null. Never echoes the input. */
export function loginErrorMessage(code: unknown): string | null {
  return typeof code === "string" && Object.prototype.hasOwnProperty.call(LOGIN_ERRORS, code)
    ? LOGIN_ERRORS[code as LoginErrorCode]
    : null;
}
