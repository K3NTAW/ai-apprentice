// Global auth gate.
// Next 16 proxy convention (formerly middleware.ts): https://nextjs.org/docs/app/api-reference/file-conventions/proxy
// Session refresh per the Supabase SSR guide: https://supabase.com/docs/guides/auth/server-side/nextjs
//
// Every path except '/', /login/* and /auth/* (/auth/callback, /auth/reset, /auth/signout) is protected, pages
// and /api alike (/api/auth/bootstrap too: it needs the session cookie).
// An Auth outage is not distinguished from a missing session: getUser throwing or
// returning an error fails closed (redirect to /login, or 401 on /api).
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
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

export async function proxy(request: NextRequest): Promise<NextResponse> {
  const mode = appMode();
  if (mode === "local") return NextResponse.next();

  const url = new URL(request.url);
  const { pathname, search } = url;
  const isPublic = isPublicPath(pathname);
  const isApi = isApiPath(pathname);

  const env = mode === "supabase" ? publicSupabaseEnv() : null;
  if (!env) {
    if (isPublic) return NextResponse.next();
    if (isApi) return NextResponse.json({ error: "supabase_not_configured" }, { status: 503 });
    return new NextResponse("Supabase is not configured.", {
      status: 503,
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  let response = NextResponse.next({ request });
  let pendingCookies: PendingCookie[] = [];
  let pendingHeaders: Record<string, string> = {};
  const supabase = createServerClient(env.url, env.anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        pendingCookies = [...pendingCookies, ...cookiesToSet];
        pendingHeaders = { ...pendingHeaders, ...(headers ?? {}) };
        for (const { name, value, options } of pendingCookies) response.cookies.set(name, value, options);
        for (const [k, v] of Object.entries(pendingHeaders)) response.headers.set(k, v);
      },
    },
  });

  let signedIn = false;
  try {
    const { data, error } = await supabase.auth.getUser();
    signedIn = !error && !!data?.user;
  } catch {
    signedIn = false;
  }

  if (signedIn || isPublic) return response;

  const out = isApi
    ? NextResponse.json({ error: "unauthorized" }, { status: 401 })
    : NextResponse.redirect(new URL(`/login?next=${encodeURIComponent(safeNext(pathname + search))}`, url.origin));
  for (const { name, value, options } of pendingCookies) out.cookies.set(name, value, options);
  for (const [k, v] of Object.entries(pendingHeaders)) out.headers.set(k, v);
  return out;
}

// '/api/:path*' always matches, so the static-extension exclusion below never ungates an API path.
export const config = {
  matcher: [
    "/api/:path*",
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|css|js|map|txt|xml|woff|woff2|ttf|otf)$).*)",
  ],
};
