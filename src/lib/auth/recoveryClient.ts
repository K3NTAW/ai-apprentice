// Browser-only Supabase client for the password reset. Implicit flow: the recovery link carries the session in
// the URL hash, so it works in whatever browser opens it (the desktop app asks, the system browser opens the link).
// Nothing is persisted; /auth/reset sets the session from the hash, updates the password and signs out.
import { createClient } from "@supabase/supabase-js";
import { publicSupabaseEnv } from "@/lib/supabase/env";

export function createRecoveryClient() {
  const env = publicSupabaseEnv();
  if (!env) throw new Error("supabase_not_configured");
  return createClient(env.url, env.anonKey, {
    auth: { flowType: "implicit", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
