import { requireContext } from "@/lib/auth/context";
import { log, withRequestLog } from "@/lib/log";
import { clampVoiceSeconds, isVoiceToken, recordVoiceSeconds } from "@/lib/usage/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Client-reported seconds for a token issued by GET /api/voice/signed-url (docs/checks/cost-meter.md, Voice).
// Any member role. No daily cap here: usage_counters already caps signed-url calls per day.
async function handlePOST(req: Request): Promise<Response> {
  const ctx = await requireContext();
  if (ctx instanceof Response) return ctx;
  const body = (await req.json().catch(() => null)) as { usage_token?: unknown; seconds?: unknown } | null;
  const token = body?.usage_token;
  const raw = body?.seconds;
  if (!isVoiceToken(token) || typeof raw !== "number" || !Number.isFinite(raw)) {
    return Response.json({ error: "invalid body" }, { status: 400 });
  }
  const seconds = clampVoiceSeconds(raw);
  if (ctx.mode === "local") return Response.json({ ok: true, local: true });
  const res = await recordVoiceSeconds(ctx, token, seconds);
  if (res.ok) return Response.json({ ok: true, seconds: res.seconds });
  if (res.reason === "unknown") return Response.json({ error: "unknown token" }, { status: 404 });
  if (res.reason === "already_recorded") return Response.json({ error: "already recorded" }, { status: 409 });
  try {
    log.warn("usage.events", { reason: "voice_update_error", kind: "voice" });
  } catch {}
  return Response.json({ error: "usage_unavailable" }, { status: 503 });
}

export const POST = withRequestLog("/api/voice/usage", handlePOST);
