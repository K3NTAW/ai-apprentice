// Global auth gate.
// Next 16 proxy convention (formerly middleware.ts): https://nextjs.org/docs/app/api-reference/file-conventions/proxy
// Session refresh per the Supabase SSR guide: https://supabase.com/docs/guides/auth/server-side/nextjs
//
// Every page except '/', /login/* and /auth/* (/auth/callback, /auth/reset, /auth/confirmed, /auth/signout) is protected.
// One Auth round trip per page request at most: /api/* (route handlers run requireContext and answer 401 themselves),
// router prefetches and static assets skip getUser. A page request refreshes the session once and forwards the
// verified user (signed header, see lib/auth/forwardedUser) so getRequestContext does not call getUser again.
// An Auth outage is not distinguished from a missing session: getUser throwing or returning an error fails closed
// (redirect to /login).
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { FORWARDED_USER_HEADER, signForwardedUser } from "@/lib/auth/forwardedUser";
import { safeNext } from "@/lib/auth/redirect";
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

/** Next.js router prefetches (link viewport and hover prefetch, RSC prefetch) and browser speculative loads. */
export function isPrefetchRequest(request: NextRequest): boolean {
  const h = request.headers;
  return (
    h.get("next-router-prefetch") === "1" ||
    h.has("x-middleware-prefetch") ||
    h.get("purpose") === "prefetch" ||
    /\bprefetch\b/.test(h.get("sec-purpose") ?? "")
  );
}

const STATIC_ASSET = /\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|xml|woff|woff2|ttf|otf)$/;
function isStaticAsset(pathname: string): boolean {
  return pathname.startsWith("/_next/") || STATIC_ASSET.test(pathname);
}

export async function proxy(request: NextRequest): Promise<NextResponse> {
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

  // No Auth round trip here: route handlers run requireContext (401 when signed out), a prefetch is followed by
  // the real navigation (the page resolves the user itself), and static assets carry no user data.
  if (isApi || isPrefetchRequest(request) || isStaticAsset(pathname)) return pass();

  // Page request: refresh the session once (Supabase SSR guide) and forward the verified user to the render.
  let pendingCookies: PendingCookie[] = [];
  let pendingHeaders: Record<string, string> = {};
  const supabase = createServerClient(env.url, env.anonKey, {
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
    if (signedIn) requestHeaders.set(FORWARDED_USER_HEADER, signForwardedUser(data.user));
  } catch {
    signedIn = false;
  }
  const timing = `proxy-auth;dur=${(performance.now() - t0).toFixed(1)}`;

  const out =
    signedIn || isPublic
      ? pass()
      : NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(safeNext(pathname + search))}`, url.origin));
  for (const { name, value, options } of pendingCookies) out.cookies.set(name, value, options);
  for (const [k, v] of Object.entries(pendingHeaders)) out.headers.set(k, v);
  out.headers.append("Server-Timing", timing);
  return out;
}

// '/api/:path*' always matches, so the static-extension exclusion below never ungates an API path.
export const config = {
  matcher: [
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|xml|woff|woff2|ttf|otf)$).*)",
  ],
};
