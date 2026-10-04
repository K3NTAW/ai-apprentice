// Password login (T-0160): after signInWithPassword / signUp in the browser client the session cookie exists;
// this runs the same workspace bootstrap and ws cookie rule as the magic-link callback (lib/auth/signIn).
// Needs the session cookie (getUser, never getSession): 401 without one. Response: 200 { redirect } (a safe next,
// default /agents) or { error } with 400/401/429/500/503. Throttled in memory: 30 calls per IP in 10 minutes.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { WS_COOKIE, wsCookieOptions } from "@/lib/auth/cookies";
import { PASSWORD_LOGIN_DEFAULT_NEXT } from "@/lib/auth/passwordLogin";
import { safeNext } from "@/lib/auth/redirect";
import { bootstrapAfterSignIn } from "@/lib/auth/signIn";
import { bootstrapThrottle, clientIp } from "@/lib/auth/throttle";
import { appMode, publicSupabaseEnv } from "@/lib/supabase/env";

type PendingCookie = { name: string; value: string; options: CookieOptions };

export async function POST(request: NextRequest): Promise<Response> {
  const fail = (error: string, status: number) => NextResponse.json({ error }, { status });

  const env = appMode() === "supabase" ? publicSupabaseEnv() : null;
  if (!env) return fail("supabase_not_configured", 503);
  // JSON only: a cross-site form post cannot send this content type without a CORS preflight.
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return fail("bad_request", 400);
  }
  if (!bootstrapThrottle.hit(clientIp(request.headers))) return fail("rate_limited", 429);

  let body: { next?: unknown } = {};
  try {
    const text = await request.text();
    if (text) body = (JSON.parse(text) ?? {}) as typeof body;
  } catch {
    return fail("bad_request", 400);
  }
  const next = safeNext(body?.next, PASSWORD_LOGIN_DEFAULT_NEXT);

  const pendingCookies: PendingCookie[] = [];
  const pendingHeaders: Record<string, string> = {};
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        pendingCookies.push(...cookiesToSet);
        Object.assign(pendingHeaders, headers ?? {});
      },
    },
  });
  const withCookies = (res: NextResponse) => {
    for (const { name, value, options } of pendingCookies) res.cookies.set(name, value, options);
    for (const [k, v] of Object.entries(pendingHeaders)) res.headers.set(k, v);
    return res;
  };

  let userId: string | null = null;
  try {
    const { data, error } = await supabase.auth.getUser();
    if (!error) userId = data?.user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return withCookies(fail("unauthorized", 401));

  const boot = await bootstrapAfterSignIn(supabase, userId);
  if (!boot.ok) return withCookies(fail("workspace_setup_failed", 500));

  const res = withCookies(NextResponse.json({ redirect: next }));
  if (boot.wsCookie) res.cookies.set(WS_COOKIE, boot.wsCookie, wsCookieOptions());
  return res;
}
