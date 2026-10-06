// Voice seconds for a server-issued usage token (docs/checks/cost-meter.md, Voice).
// GET /api/voice/signed-url inserts the row with voice_seconds null; POST /api/voice/usage sets it once.
// Seconds are client-reported and untrusted: clamped to 0..7200 per token. Writes go through the service role client.
import type { RequestContext } from "@/lib/auth/context";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const VOICE_TOKEN_RE = /^v_[0-9a-f-]{36}$/;
export const MAX_VOICE_SECONDS = 7200;

export type VoiceSecondsResult =
  | { ok: true; seconds: number }
  | { ok: false; reason: "unknown" | "already_recorded" | "error" };

export function newVoiceToken(): string {
  return `v_${crypto.randomUUID()}`;
}

export function isVoiceToken(v: unknown): v is string {
  return typeof v === "string" && VOICE_TOKEN_RE.test(v);
}

/** Clamps to 0..7200. Callers check Number.isFinite first. */
export function clampVoiceSeconds(seconds: number): number {
  return Math.min(MAX_VOICE_SECONDS, Math.max(0, seconds));
}

/**
 * Sets voice_seconds once on the caller's own row for this token in the active workspace.
 * No row updated: a row of this workspace and user with seconds already set -> already_recorded, else unknown
 * (other workspace, other user and invented tokens look the same). Never throws.
 */
export async function recordVoiceSeconds(ctx: RequestContext, token: string, seconds: number): Promise<VoiceSecondsResult> {
  try {
    const admin = createSupabaseAdminClient();
    const scoped = () => ({ kind: "voice", session_id: token, workspace_id: ctx.workspaceId, user_id: ctx.userId });
    const { data, error } = await admin
      .from("usage_events")
      .update({ voice_seconds: seconds })
      .match(scoped())
      .is("voice_seconds", null)
      .select("id");
    if (error) return { ok: false, reason: "error" };
    if (Array.isArray(data) && data.length > 0) return { ok: true, seconds };
    const existing = await admin.from("usage_events").select("id").match(scoped()).limit(1);
    if (existing.error) return { ok: false, reason: "error" };
    return { ok: false, reason: Array.isArray(existing.data) && existing.data.length > 0 ? "already_recorded" : "unknown" };
  } catch {
    return { ok: false, reason: "error" };
  }
}
