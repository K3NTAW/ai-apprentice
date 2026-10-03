// Per-workspace daily caps on the paid API calls (vision, decide, workmap, voice).
// Counting happens in Postgres (public.consume_usage, supabase/migrations/20261003010000_usage.sql),
// keyed on the Europe/Zurich date. Local mode never counts.
import type { RequestContext } from "@/lib/auth/context";

export type UsageKind = "vision" | "decide" | "workmap" | "voice";

export const DEFAULT_CAPS: Record<UsageKind, number> = {
  vision: 3000,
  decide: 2000,
  workmap: 50,
  voice: 60,
};

const CAP_ENV: Record<UsageKind, string> = {
  vision: "USAGE_CAP_VISION",
  decide: "USAGE_CAP_DECIDE",
  workmap: "USAGE_CAP_WORKMAP",
  voice: "USAGE_CAP_VOICE",
};

/** Cap per workspace per day: the env value when it is a non-negative integer, else the default. */
export function usageCap(kind: UsageKind): number {
  const raw = process.env[CAP_ENV[kind]]?.trim();
  if (raw && /^\d+$/.test(raw)) return Number(raw);
  return DEFAULT_CAPS[kind];
}

/**
 * Counts one call of `kind` for the active workspace. {allowed: true} when under the cap,
 * else 429 {error:'daily_limit', kind}. A failed RPC answers 503 so a broken counter never
 * turns into unmetered spend.
 */
export async function consumeUsage(ctx: RequestContext, kind: UsageKind): Promise<{ allowed: true } | Response> {
  if (ctx.mode === "local" || !ctx.supabase) return { allowed: true };
  const { data, error } = await ctx.supabase.rpc("consume_usage", {
    ws: ctx.workspaceId,
    k: kind,
    cap: usageCap(kind),
  });
  if (error) {
    console.error("consume_usage:", error.message);
    return Response.json({ error: "usage_unavailable" }, { status: 503 });
  }
  if (data === false) return Response.json({ error: "daily_limit", kind }, { status: 429 });
  return { allowed: true };
}
