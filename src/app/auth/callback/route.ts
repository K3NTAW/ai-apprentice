// Magic-link callback. Exchanges the code for a session, bootstraps the workspace and
// redirects to a safe next path. Session cookies and the ws cookie are written onto the
// returned redirect response itself, so they never depend on implicit cookie merging.
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { bootstrapMemberships, readMemberships } from "@/lib/auth/context";
import { WS_COOKIE, wsCookieOptions } from "@/lib/auth/cookies";
import { safeNext, type LoginErrorCode } from "@/lib/auth/redirect";
import { appMode, publicSupabaseEnv } from "@/lib/supabase/env";

type PendingCookie = { name: string; value: string; options: CookieOptions };

export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const origin = url.origin;
  const redirectTo = (path: string) => NextResponse.redirect(new URL(path, origin));
  const fail = (code: LoginErrorCode) => redirectTo(`/login?error=${code}`);

  const mode = appMode();
  if (mode === "local") return redirectTo("/capture");
  const env = mode === "supabase" ? publicSupabaseEnv() : null;
  if (!env) return fail("workspace_setup_failed");

  const code = url.searchParams.get("code");
  if (!code) return fail("missing_code");
  const next = safeNext(url.searchParams.get("next"));

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
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) userId = data?.user?.id ?? data?.session?.user?.id ?? null;
  } catch {
    userId = null;
  }
  if (!userId) return withCookies(fail("link_invalid"));

  // Same rule as getRequestContext: a membership read error is not zero memberships.
  const before = await readMemberships(supabase, userId);
  if (!before.ok) return withCookies(fail("workspace_setup_failed"));
  const boot = await bootstrapMemberships(supabase);
  if (!boot.ok || boot.memberships.length === 0) return withCookies(fail("workspace_setup_failed"));

  const res = withCookies(redirectTo(next));
  // An accepted invite adds a workspace the user was not in before; land there.
  // Deterministic pick: the lowest workspace_id among the new ones.
  const known = new Set(before.memberships.map((m) => m.workspaceId));
  const added = boot.memberships
    .map((m) => m.workspaceId)
    .filter((id) => !known.has(id))
    .sort();
  if (added.length > 0) res.cookies.set(WS_COOKIE, added[0], wsCookieOptions());
  return res;
}
