// The user the proxy verified with getUser, forwarded to the page render as a signed request header so
// getRequestContext does not call getUser a second time in the same request.
// Trust: the proxy deletes any incoming header of this name before it sets its own, and the value is an HMAC over
// the user and a short expiry, so a client-sent value (or a request that bypassed the proxy) never verifies.
// Key: FORWARDED_USER_SECRET, else derived from SUPABASE_SERVICE_ROLE_KEY, else a random per-process key
// (then a render on another instance just falls back to getUser).
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const FORWARDED_USER_HEADER = "x-aa-verified-user";
export const FORWARDED_USER_TTL_MS = 30_000;

export type ForwardedUser = { id: string; email: string | null; email_confirmed_at: string | null };

let processKey: Buffer | null = null;
function key(): Buffer {
  const secret = process.env.FORWARDED_USER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (secret) return createHash("sha256").update(`aa-forwarded-user:${secret}`).digest();
  processKey ??= randomBytes(32);
  return processKey;
}

const sign = (payload: string) => createHmac("sha256", key()).update(payload).digest("base64url");

export function signForwardedUser(
  user: { id: string; email?: string | null; email_confirmed_at?: string | null },
  now = Date.now(),
): string {
  const body: ForwardedUser & { exp: number } = {
    id: user.id,
    email: user.email ?? null,
    email_confirmed_at: user.email_confirmed_at ?? null,
    exp: now + FORWARDED_USER_TTL_MS,
  };
  const payload = Buffer.from(JSON.stringify(body)).toString("base64url");
  return `${payload}.${sign(payload)}`;
}

/** The forwarded user, or null when the value is missing, malformed, expired or not signed with our key. */
export function verifyForwardedUser(value: string | null | undefined, now = Date.now()): ForwardedUser | null {
  if (!value) return null;
  const [payload, sig, extra] = value.split(".");
  if (!payload || !sig || extra !== undefined) return null;
  const expected = Buffer.from(sign(payload));
  const got = Buffer.from(sig);
  if (expected.length !== got.length || !timingSafeEqual(expected, got)) return null;
  try {
    const body = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ForwardedUser & { exp: number };
    if (typeof body.id !== "string" || !body.id || typeof body.exp !== "number" || body.exp < now) return null;
    return { id: body.id, email: body.email ?? null, email_confirmed_at: body.email_confirmed_at ?? null };
  } catch {
    return null;
  }
}
