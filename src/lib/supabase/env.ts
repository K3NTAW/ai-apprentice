// Supabase env detection. A value counts as set only when it is a non-empty string after trim.
// NEXT_PUBLIC_* are read as literal process.env.X expressions because Next inlines only literal access.

export type AppMode = "local" | "supabase" | "misconfigured";

function clean(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function readPublic(): { url: string | null; anonKey: string | null } {
  return {
    url: clean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    anonKey: clean(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY),
  };
}

function modeFor(values: Array<string | null>): AppMode {
  const set = values.filter((v) => v !== null).length;
  if (set === values.length) return "supabase";
  if (set > 0) return "misconfigured";
  return process.env.NODE_ENV === "production" ? "misconfigured" : "local";
}

/** Both public vars set, else null. Browser safe. */
export function publicSupabaseEnv(): { url: string; anonKey: string } | null {
  const { url, anonKey } = readPublic();
  return url && anonKey ? { url, anonKey } : null;
}

/** All three vars set, else null. Server only. */
export function supabaseEnv(): { url: string; anonKey: string; serviceRoleKey: string } | null {
  const pub = publicSupabaseEnv();
  const serviceRoleKey = clean(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return pub && serviceRoleKey ? { ...pub, serviceRoleKey } : null;
}

/** Server only. Mode over the two public vars and the service role key. */
export function appMode(): AppMode {
  const { url, anonKey } = readPublic();
  return modeFor([url, anonKey, clean(process.env.SUPABASE_SERVICE_ROLE_KEY)]);
}

/** Browser safe. Same table over the two public vars only. */
export function clientMode(): AppMode {
  const { url, anonKey } = readPublic();
  return modeFor([url, anonKey]);
}
