// Password login (T-0160): after signInWithPassword / signUp in the browser client the session cookie exists;
// this runs the same workspace bootstrap and ws cookie rule as the magic-link callback (lib/auth/signIn).
// requireContext first: 401 without a session, 503 misconfigured, 403 no_workspace. Then 403 email_not_confirmed
// when the user's address is not confirmed (defense in depth: bootstrap_workspace checks email_confirmed_at too).
// Response: 200 { redirect } (a safe next, default /agents) or { error }.
// Throttled in memory (T-0163): signed-in attempts count per user id (20 in 10 minutes); unauthenticated 401s count
// per client IP with a looser limit (60 in 10 minutes). Either limit answers 429.
import { NextResponse } from "next/server";
import { WS_COOKIE, wsCookieOptions } from "@/lib/auth/cookies";
import { requireContext } from "@/lib/auth/context";
import { PASSWORD_LOGIN_DEFAULT_NEXT } from "@/lib/auth/passwordLogin";
import { safeNext } from "@/lib/auth/redirect";
import { bootstrapAfterSignIn } from "@/lib/auth/signIn";
import { bootstrapThrottle, clientIp } from "@/lib/auth/throttle";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<Response> {
  const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

  const ctx = await requireContext();
  if (ctx instanceof Response) {
    if (ctx.status === 401 && !bootstrapThrottle.unauthIp.hit(clientIp(request.headers))) return fail("rate_limited", 429);
    return ctx;
  }
  if (ctx.mode === "local" || !ctx.supabase) return fail("local_mode", 400);
  if (!bootstrapThrottle.user.hit(ctx.userId)) return fail("rate_limited", 429);
  if (!ctx.emailConfirmedAt) return fail("email_not_confirmed", 403);

  // JSON only: a cross-site form post cannot send this content type without a CORS preflight.
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return fail("bad_request", 400);
  }
  let body: { next?: unknown } = {};
  try {
    const text = await request.text();
    if (text) body = (JSON.parse(text) ?? {}) as typeof body;
  } catch {
    return fail("bad_request", 400);
  }
  const next = safeNext(body?.next, PASSWORD_LOGIN_DEFAULT_NEXT);

  const boot = await bootstrapAfterSignIn(ctx.supabase, ctx.userId);
  if (!boot.ok) return fail("workspace_setup_failed", 500);
  // bootstrapAfterSignIn expired this user's cached memberships and the joined workspace's member list.

  const res = NextResponse.json({ redirect: next });
  if (boot.wsCookie) res.cookies.set(WS_COOKIE, boot.wsCookie, wsCookieOptions());
  return res;
}
