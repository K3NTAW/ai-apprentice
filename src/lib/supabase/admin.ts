import { createClient } from "@supabase/supabase-js";
import { supabaseEnv } from "./env";

// Service role client: bypasses RLS. Never import from a 'use client' file.
export function createSupabaseAdminClient() {
  if (typeof window !== "undefined") throw new Error("supabase_admin_in_browser");
  const env = supabaseEnv();
  if (!env) throw new Error("supabase_not_configured");
  return createClient(env.url, env.serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
