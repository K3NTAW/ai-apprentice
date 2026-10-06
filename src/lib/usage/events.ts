// Cost meter usage events (supabase/migrations/20261006000000_usage_events.sql, docs/checks/cost-meter.md).
// recordUsage never blocks or throws: the insert runs after the response through next/server after().
// Writes go through the service role client; clients have no insert policy. Local mode records nothing.
import { after } from "next/server";
import type { RequestContext } from "@/lib/auth/context";
import { log } from "@/lib/log";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export type UsageKind = "vision" | "decide" | "workmap" | "voice" | "frame";

export type UsageEvent = {
  kind: UsageKind;
  model?: string;
  input_tokens?: number;
  output_tokens?: number;
  cache_read_tokens?: number;
  voice_seconds?: number;
  bytes?: number;
  session_id?: string;
};

export type InsertResult = { ok: true } | { ok: false; reason: "conflict" | "disabled" | "error" };

export const INSERT_TIMEOUT_MS = 5000;
export const MISSING_TABLE_BACKOFF_MS = 5 * 60 * 1000;

// Set when the table is missing (migration not applied); inserts are skipped until the backoff ends.
let tableMissingAt: number | null = null;

/** True while a missing usage_events table was seen less than 5 minutes ago. */
export function isTableMissing(now: number = Date.now()): boolean {
  return tableMissingAt !== null && now - tableMissingAt < MISSING_TABLE_BACKOFF_MS;
}

/** False with USAGE_EVENTS=0 or outside supabase mode. */
export function usageEventsEnabled(ctx: RequestContext): boolean {
  return process.env.USAGE_EVENTS !== "0" && ctx?.mode === "supabase";
}

function warn(fields: Record<string, unknown>): void {
  try {
    log.warn("usage.events", fields);
  } catch {}
}

const kindOf = (event: UsageEvent) => {
  try {
    return event?.kind;
  } catch {
    return undefined;
  }
};

function row(ctx: RequestContext, e: UsageEvent) {
  return {
    workspace_id: ctx.workspaceId,
    user_id: ctx.userId,
    session_id: e.session_id ?? null,
    kind: e.kind,
    model: e.model ?? null,
    input_tokens: e.input_tokens ?? null,
    output_tokens: e.output_tokens ?? null,
    cache_read_tokens: e.cache_read_tokens ?? null,
    voice_seconds: e.voice_seconds ?? null,
    bytes: e.bytes ?? null,
  };
}

type DbError = { code?: string; message?: string } | null | undefined;

/**
 * Awaited insert (part 3's voice route needs the conflict answer). Never throws.
 * 23505 (one voice row per token) -> conflict; USAGE_EVENTS=0, local mode or a missing table -> disabled.
 * A missing table (42P01, PostgREST PGRST205) warns once and skips inserts for 5 minutes.
 */
export async function insertUsageEvent(ctx: RequestContext, event: UsageEvent): Promise<InsertResult> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    if (!usageEventsEnabled(ctx) || isTableMissing()) return { ok: false, reason: "disabled" };
    const timeout = new Promise<"timeout">((resolve) => {
      timer = setTimeout(() => {
        controller.abort();
        resolve("timeout");
      }, INSERT_TIMEOUT_MS);
    });
    const insert = createSupabaseAdminClient()
      .from("usage_events")
      .insert(row(ctx, event))
      .abortSignal(controller.signal);
    const res = await Promise.race([insert, timeout]);
    if (controller.signal.aborted) {
      warn({ reason: "timeout", kind: kindOf(event), ms: INSERT_TIMEOUT_MS });
      return { ok: false, reason: "error" };
    }
    const error = (res as { error?: DbError }).error;
    if (!error) return { ok: true };
    if (error.code === "23505") return { ok: false, reason: "conflict" };
    if (error.code === "42P01" || error.code === "PGRST205") {
      tableMissingAt = Date.now();
      warn({ reason: "table_missing", kind: kindOf(event), code: error.code });
      return { ok: false, reason: "disabled" };
    }
    warn({ reason: "insert_error", kind: kindOf(event), code: error.code ?? null, message: error.message ?? null });
    return { ok: false, reason: "error" };
  } catch (err) {
    warn({ reason: controller.signal.aborted ? "timeout" : "insert_threw", kind: kindOf(event), error: err });
    return { ok: false, reason: "error" };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Schedules one usage event after the response. Returns synchronously, never throws. */
export function recordUsage(ctx: RequestContext, event: UsageEvent): void {
  try {
    if (!usageEventsEnabled(ctx) || isTableMissing()) return;
    try {
      after(async () => {
        await insertUsageEvent(ctx, event);
      });
    } catch {
      // after() outside a request scope throws: the event is dropped.
      warn({ reason: "no_request_scope", kind: kindOf(event) });
    }
  } catch {}
}
