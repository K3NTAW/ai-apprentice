// Browser fetch adapter for the capture controller: /api/session/<id>/*, /api/decide, /api/vision.
import { AgentSchema, type Agent, type ScreenEvent } from "@/lib/types";
import type { CaptureApi, Decisions } from "./controller";

async function post<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

export function createHttpCaptureApi(sessionId: string, previousEvents: () => ScreenEvent[]): CaptureApi {
  const base = `/api/session/${encodeURIComponent(sessionId)}`;
  return {
    postEvents: (events) => post(`${base}/events`, { events }),
    postTranscript: (entries) => post(`${base}/transcript`, { entries }),
    postQA: (qa) => post(`${base}/qa`, { qa }),
    setOffRecord: (range) => post(`${base}/off-record`, range),
    decide: async (questions, state) =>
      (await post<{ results: Partial<Decisions> }>("/api/decide", { questions, state })).results,
    postFrame: (frame) =>
      post("/api/vision", {
        session_id: sessionId,
        t: frame.t,
        frame: frame.jpegBase64,
        previous: previousEvents().slice(-8),
      }),
  };
}

/** Creates the capture session; agent_id links it to the agent it trains. */
export async function createCaptureSession(expert: string, agentId?: string | null): Promise<string> {
  const s = await post<{ id: string }>("/api/session", { kind: "capture", expert, ...(agentId ? { agent_id: agentId } : {}) });
  return s.id;
}

/** POST /api/session/<id>/end; never throws (logged), the debrief opens either way. */
export async function endCaptureSession(sessionId: string, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  try {
    const res = await fetchImpl(`/api/session/${encodeURIComponent(sessionId)}/end`, { method: "POST" });
    if (!res.ok) throw new Error(`end ${res.status}`);
    return true;
  } catch (err) {
    console.warn("capture: could not end the session", err instanceof Error ? err.message : err);
    return false;
  }
}

/** End task: POST /end first, then open the debrief (also when ending failed). */
export async function endThenNavigate(sessionId: string, navigate: () => void, fetchImpl: typeof fetch = fetch): Promise<void> {
  await endCaptureSession(sessionId, fetchImpl);
  navigate();
}

/** The session's agent from /api/agents/<id>; null when missing, unreadable or malformed. */
export async function loadAgent(agentId: string | null | undefined, fetchImpl: typeof fetch = fetch): Promise<Agent | null> {
  if (!agentId) return null;
  try {
    const res = await fetchImpl(`/api/agents/${encodeURIComponent(agentId)}`);
    if (!res.ok) return null;
    const parsed = AgentSchema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
