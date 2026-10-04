import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { persistentCookie, sessionCookieOptions } from "./cookieOptions";
import { publicSupabaseEnv } from "./env";

// Server client per https://supabase.com/docs/guides/auth/server-side/nextjs
// Session refresh belongs in the Next 16 request-interception file (proxy.ts, formerly middleware.ts);
// the later auth task adds it, this module does not.
export async function createSupabaseServerClient() {
  const env = publicSupabaseEnv();
  if (!env) throw new Error("supabase_not_configured");
  const cookieStore = await cookies();
  return createServerClient(env.url, env.anonKey, {
    cookieOptions: sessionCookieOptions(),
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, persistentCookie(value, options));
          }
        } catch {
          // Server Components cannot set cookies; proxy.ts refreshes the session instead.
        }
      },
    },
  });
}
