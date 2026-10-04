// Global auth gate.
// Next 16 proxy convention (formerly middleware.ts): https://nextjs.org/docs/app/api-reference/file-conventions/proxy
// Session refresh per the Supabase SSR guide: https://supabase.com/docs/guides/auth/server-side/nextjs
//
// Every page except '/', /login/* and /auth/* (/auth/callback, /auth/reset, /auth/confirmed, /auth/signout) is protected.
// One Auth round trip per request at most. Only /api/* (route handlers run requireContext and answer 401 themselves)
// and /_next/* (plus the matcher's excluded files) skip getUser. Client headers never skip it: a router prefetch
// (next-router-prefetch, purpose, sec-purpose, x-middleware-prefetch) is a page request like any other, refreshes
// the session once and is redirected when signed out; a page path ending in .js or .css is still a page.
// A page request forwards the verified user (signed header, see lib/auth/forwardedUser) so getRequestContext does
// not call getUser again.
// Server-Timing on pages: ctx-auth (the proxy getUser, the only one per page), db (store time in the proxy: none,
// so 0; the render's memberships read is logged with PERF_LOG=1) and total (proxy start to response).
// Refreshed session cookies go onto every page response, the /login redirect included, always with a max-age
// (lib/supabase/cookieOptions), so the session survives a browser restart.
// An Auth outage is not distinguished from a missing session: getUser throwing or returning an error fails closed
// (redirect to /login).
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { FORWARDED_USER_HEADER, signForwardedUser } from "@/lib/auth/forwardedUser";
import { safeNext } from "@/lib/auth/redirect";

import { persistentCookie, sessionCookieOptions } from "@/lib/supabase/cookieOptions";
import { appMode, publicSupabaseEnv } from "@/lib/supabase/env";

function segments(pathname: string): string[] {
  return pathname.split("/").slice(1);
}

/** '/' exactly, or first segment 'login' or 'auth' with no empty segment anywhere. */
function isPublicPath(pathname: string): boolean {
  if (pathname === "/") return true;
  const segs = segments(pathname);
  if (segs.some((s) => s === "")) return false;
  return segs[0] === "login" || segs[0] === "auth";
}

function isApiPath(pathname: string): boolean {
  return segments(pathname)[0] === "api";
}

type PendingCookie = { name: string; value: string; options: CookieOptions };

/** Next internals only. A file extension on any other path proves nothing (the matcher excludes real files). */
function isNextAsset(pathname: string): boolean {
  return pathname.startsWith("/_next/");
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const start = performance.now();
  // Never trust a client-sent forwarded user: strip it from every request before anything else.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete(FORWARDED_USER_HEADER);
  const pass = () => NextResponse.next({ request: { headers: requestHeaders } });

  const mode = appMode();
  if (mode === "local") return pass();

  const url = new URL(request.url);
  const { pathname, search } = url;
  const isPublic = isPublicPath(pathname);
  const isApi = isApiPath(pathname);

  const env = mode === "supabase" ? publicSupabaseEnv() : null;
  if (!env) {
    if (isPublic) return pass();
    if (isApi) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
    return new NextResponse("Supabase is not configured.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  // No Auth round trip here: route handlers run requireContext (401 when signed out); Next assets carry no user data.
  if (isApi || isNextAsset(pathname)) return pass();

  // Page request: refresh the session once (Supabase SSR guide) and forward the verified user to the render.
  let pendingCookies: PendingCookie[] = [];
  let pendingHeaders: Record<string, string> = {};
  const supabase = createServerClient(env.url, env.anonKey, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        requestHeaders.set("cookie", request.headers.get("cookie") ?? "");
        pendingCookies = [...pendingCookies, ...cookiesToSet];
        pendingHeaders = { ...pendingHeaders, ...(headers ?? {}) };
      },
    },
  });

  const t0 = performance.now();
  let signedIn = false;
  try {
    const { data, error } = await supabase.auth.getUser();
    signedIn = !error && !!data?.user;
    const signed = signedIn && data.user ? signForwardedUser(data.user) : null;
    if (signed) requestHeaders.set(FORWARDED_USER_HEADER, signed);
  } catch {
    signedIn = false;
  }
  const ctxAuth = performance.now() - t0;

  const out =
    signedIn || isPublic
      ? pass()
      : NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(safeNext(pathname + search))}`, url.origin));
  for (const { name, value, options } of pendingCookies) out.cookies.set(name, value, persistentCookie(value, options));
  for (const [k, v] of Object.entries(pendingHeaders)) out.headers.set(k, v);
  out.headers.append("Server-Timing", serverTiming({ "ctx-auth": ctxAuth, db: 0, total: performance.now() - start }));
  return out;
}

// '/api/:path*' always matches, so the static-extension exclusion below never ungates an API path.
export const config = {
  matcher: [
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|xml|woff|woff2|ttf|otf)$).*)",
  ],
};

const serverTiming = (t: Record<string, number>) =>
  Object.entries(t)
    .map(([n, ms]) => `${n};dur=${ms.toFixed(1)}`)
    .join(", ");
