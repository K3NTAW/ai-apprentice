import { createBrowserClient } from "@supabase/ssr";
import { sessionCookieOptions } from "./cookieOptions";
import { publicSupabaseEnv } from "./env";

export function createSupabaseBrowserClient() {
  const env = publicSupabaseEnv();
  if (!env) throw new Error("supabase_not_configured");
  return createBrowserClient(env.url, env.anonKey, { cookieOptions: sessionCookieOptions() });
}
