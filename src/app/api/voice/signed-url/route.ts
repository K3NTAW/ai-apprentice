import { requireContext } from "@/lib/auth/context";

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

export async function GET(req: Request): Promise<Response> {
  // Signed-in member of a workspace only (401 signed out, 503 misconfigured).
  const ctx = await requireContext();
  if (ctx instanceof Response) return ctx;
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
  return Response.json({ signed_url: body.signed_url });
}
