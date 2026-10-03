// Code login (one-app D2): verifies the emailed one-time code server side (verifyOtp type 'email'), then runs the
// same workspace bootstrap and ws cookie rule as the magic-link callback. Session cookies and the ws cookie are
// written onto the JSON response itself. Response: 200 { redirect } (a safe next, default /agents) or
// { error: VerifyErrorCode } with 400/403/429/500/503; the login form shows fixed texts for the codes.
// Throttled in memory (lib/auth/verifyThrottle): 10 attempts per email and 30 per IP in 10 minutes, then 429.
// The token must be exactly SUPABASE_OTP_LENGTH digits (default 6).
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { WS_COOKIE, wsCookieOptions } from "@/lib/auth/cookies";
import { CODE_LOGIN_DEFAULT_NEXT, isOtpCodeOfLength, type VerifyErrorCode } from "@/lib/auth/codeLogin";
import { clientIp, verifyThrottle } from "@/lib/auth/verifyThrottle";
import { safeNext } from "@/lib/auth/redirect";
import { bootstrapAfterSignIn } from "@/lib/auth/signIn";
import { appMode, publicSupabaseEnv } from "@/lib/supabase/env";

type PendingCookie = { name: string; value: string; options: CookieOptions };

const EMAIL_MAX = 320;

function verifyError(err: { status?: number; code?: string }): { code: VerifyErrorCode; status: number } {
  if (err.status === 429 || /rate_limit/.test(err.code ?? "")) return { code: "rate_limited", status: 429 };
  if (err.code === "otp_expired") return { code: "code_expired", status: 403 };
  return { code: "code_invalid", status: 403 };
}

export async function POST(request: NextRequest): Promise<Response> {
  const fail = (code: VerifyErrorCode, status: number) => NextResponse.json({ error: code }, { status });

  const env = appMode() === "supabase" ? publicSupabaseEnv() : null;
  if (!env) return fail("workspace_setup_failed", 503);
  // JSON only: a cross-site form post cannot send this content type without a CORS preflight.
  if (!(request.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return fail("bad_request", 400);
  }

  if (!verifyThrottle.ip.hit(clientIp(request.headers))) return fail("rate_limited", 429);

  let body: { email?: unknown; token?: unknown; next?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return fail("bad_request", 400);
  }
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!email || email.length > EMAIL_MAX || !email.includes("@")) return fail("bad_request", 400);
  if (!verifyThrottle.email.hit(email.toLowerCase())) return fail("rate_limited", 429);
  if (!isOtpCodeOfLength(token)) return fail("code_invalid", 400);
  const next = safeNext(body?.next, CODE_LOGIN_DEFAULT_NEXT);

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
    const { data, error } = await supabase.auth.verifyOtp({ email, token, type: "email" });
    if (error) {
      const e = verifyError(error);
      return withCookies(fail(e.code, e.status));
    }
    userId = data?.user?.id ?? data?.session?.user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return withCookies(fail("code_invalid", 403));

  const boot = await bootstrapAfterSignIn(supabase, userId);
  if (!boot.ok) return withCookies(fail("workspace_setup_failed", 500));

  const res = withCookies(NextResponse.json({ redirect: next }));
  if (boot.wsCookie) res.cookies.set(WS_COOKIE, boot.wsCookie, wsCookieOptions());
  return res;
}
