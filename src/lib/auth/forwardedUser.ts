// The user the proxy verified with getUser, forwarded to the page render as a signed request header so
// getRequestContext does not call getUser a second time in the same request.
// Trust: the proxy deletes any incoming header of this name before it sets its own, and the value is an HMAC over
// the user and a short expiry, so a client-sent value (or a request that bypassed the proxy) never verifies.
// Key: FORWARDED_USER_SECRET, else derived from SUPABASE_SERVICE_ROLE_KEY (set on Vercel anyway). With neither, one
// warning on the first request and nothing is forwarded: the render calls getUser itself (two getUser per page request).
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { parseState, stateFromUser, type OnboardingState } from "@/lib/onboarding/state";

export const FORWARDED_USER_HEADER = "x-aa-verified-user";
export const FORWARDED_USER_TTL_MS = 30_000;

export type ForwardedUser = {
  id: string;
  email: string | null;
  email_confirmed_at: string | null;
  full_name?: string | null;
  /** Onboarding state (T-0211) from user_metadata, always forwarded (T-0255) so the render sees a finished user as finished. */
  onboarding?: OnboardingState;
};

function key(): Buffer | null {
  const secret = process.env.FORWARDED_USER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  return secret ? createHash("sha256").update(`aa-forwarded-user:${secret}`).digest() : null;
}

let warned = false;
/**
 * Logs once per process when no key is configured. Runs on the first sign (the first proxied page request after
 * startup), not at import: a console call at import time trips Next's patched console outside a request.
 */
export function warnIfNoForwardedUserKey(): void {
  if (warned || key()) return;
  warned = true;
  console.warn(
    "forwardedUser: neither FORWARDED_USER_SECRET nor SUPABASE_SERVICE_ROLE_KEY is set; the proxy does not forward the verified user and pages call getUser twice.",
  );
}

const sign = (k: Buffer, payload: string) => createHmac("sha256", k).update(payload).digest("base64url");

export function signForwardedUser(
  user: {
    id: string;
    email?: string | null;
    email_confirmed_at?: string | null;
    created_at?: string | null;
    user_metadata?: { full_name?: unknown; [key: string]: unknown } | null;
  },
  now = Date.now(),
): string | null {
  const k = key();
  if (!k) {
    warnIfNoForwardedUserKey();
    return null;
  }
  const fullName = user.user_metadata?.full_name;
  const onboarding = stateFromUser(user);
  const body: ForwardedUser & { exp: number } = {
    id: user.id,
    email: user.email ?? null,
    email_confirmed_at: user.email_confirmed_at ?? null,
    ...(typeof fullName === "string" && fullName.trim() ? { full_name: fullName.trim().slice(0, 60) } : {}),
    onboarding,
    exp: now + FORWARDED_USER_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${sign(k, payload)}`;
}

/** The forwarded user, or null when no key is configured or the value is missing, malformed, expired or not signed with our key. */
export function verifyForwardedUser(value: string | null | undefined, now = Date.now()): ForwardedUser | null {
  const k = key();
  if (!value || !k) return null;
  const [payload, sig, extra] = value.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(k, payload));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ForwardedUser & { exp: number };
    if (typeof body.id !== "string" || !body.id || typeof body.exp !== "number" || body.exp < now) return null;
    const user: ForwardedUser = { id: body.id, email: body.email ?? null, email_confirmed_at: body.email_confirmed_at ?? null };
    if (typeof body.full_name === "string" && body.full_name) user.full_name = body.full_name;
    if (body.onboarding && typeof body.onboarding === "object") user.onboarding = parseState(body.onboarding);
    return user;
  } catch {
    return null;
  }
}
