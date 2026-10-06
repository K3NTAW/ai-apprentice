import { requireContext, type RequestContext } from "@/lib/auth/context";
import { consumeUsage } from "@/lib/usage";
import { log, withRequestLog } from "@/lib/log";
import { insertUsageEvent, isTableMissing, usageEventsEnabled } from "@/lib/usage/events";
import { newVoiceToken } from "@/lib/usage/voice";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const AGENT_ENV = {
  interviewer: "ELEVENLABS_AGENT_ID_INTERVIEWER",
  tutor: "ELEVENLABS_AGENT_ID_TUTOR",
} as const;

type Role = keyof typeof AGENT_ENV;

function isRole(r: string | null): r is Role {
  return r !== null && Object.prototype.hasOwnProperty.call(AGENT_ENV, r);
}

async function handleGET(req: Request): Promise<Response> {
  // Signed-in member of a workspace only (401 signed out, 503 misconfigured).
  const ctx = await requireContext();
  if (ctx instanceof Response) return ctx;
  // One voice session start per signed URL; daily cap per workspace (429 daily_limit).
  const usage = await consumeUsage(ctx, "voice");
  if (usage instanceof Response) return usage;
  const role = new URL(req.url).searchParams.get("role");
  if (!isRole(role)) {
    return Response.json({ error: "unknown_role", allowed: Object.keys(AGENT_ENV) }, { status: 400 });
  }
  const agentEnv = AGENT_ENV[role];
  const apiKey = process.env.ELEVENLABS_API_KEY;
  const agentId = process.env[agentEnv];
  const missing = [!apiKey && "ELEVENLABS_API_KEY", !agentId && agentEnv].filter((m): m is string => Boolean(m));
  if (!apiKey || !agentId || missing.length) {
    return Response.json({ error: "missing_env", missing }, { status: 503 });
  }

  let res: Response;
  try {
    res = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversation/get-signed-url?agent_id=${encodeURIComponent(agentId)}`,
      { headers: { "xi-api-key": apiKey }, cache: "no-store" },
    );
  } catch {
    return Response.json({ error: "upstream_unreachable" }, { status: 502 });
  }
  if (!res.ok) {
    return Response.json({ error: "upstream_error", status: res.status }, { status: 502 });
  }
  const body = (await res.json().catch(() => null)) as { signed_url?: unknown } | null;
  if (!body || typeof body.signed_url !== "string") {
    return Response.json({ error: "upstream_bad_response" }, { status: 502 });
  }
  const usageToken = await issueUsageToken(ctx);
  return Response.json({ signed_url: body.signed_url, ...(usageToken ? { usage_token: usageToken } : {}) });
}

/**
 * Inserts the voice usage row (voice_seconds null) and returns its token; POST /api/voice/usage sets the seconds.
 * Metering never blocks voice: any failure returns null with one usage.events warn. Local mode, USAGE_EVENTS=0: null.
 */
async function issueUsageToken(ctx: RequestContext): Promise<string | null> {
  try {
    if (!usageEventsEnabled(ctx)) return null;
    // insertUsageEvent already warns on errors and on a newly missing table; warn here for the silent outcomes.
    const skipped = isTableMissing();
    const token = newVoiceToken();
    const res = await insertUsageEvent(ctx, { kind: "voice", session_id: token });
    if (res.ok) return token;
    if (res.reason === "conflict") warn({ reason: "voice_token_conflict", kind: "voice" });
    else if (skipped) warn({ reason: "table_missing", kind: "voice" });
    return null;
  } catch (err) {
    warn({ reason: "voice_token_threw", kind: "voice", error: err });
    return null;
  }
}

function warn(fields: Record<string, unknown>): void {
  try {
    log.warn("usage.events", fields);
  } catch {}
}

export const GET = withRequestLog("/api/voice/signed-url", handleGET);
