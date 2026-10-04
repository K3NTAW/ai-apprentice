// Password login (T-0160): after signInWithPassword / signUp in the browser client the session cookie exists;
// this runs the same workspace bootstrap and ws cookie rule as the magic-link callback (lib/auth/signIn).
// requireContext first: 401 without a session, 503 misconfigured, 403 no_workspace. Response: 200 { redirect }
// (a safe next, default /agents) or { error }. Throttled in memory: 30 calls per IP in 10 minutes, then 429.
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

  if (!bootstrapThrottle.hit(clientIp(request.headers))) return fail("rate_limited", 429);

  const ctx = await requireContext();
  if (ctx instanceof Response) return ctx;
  if (ctx.mode === "local" || !ctx.supabase) return fail("local_mode", 400);

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

  const res = NextResponse.json({ redirect: next });
  if (boot.wsCookie) res.cookies.set(WS_COOKIE, boot.wsCookie, wsCookieOptions());
  return res;
}
