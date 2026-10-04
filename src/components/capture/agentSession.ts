// Capture seam for agents (amendment A1): creates the capture session with agent_id from ?agent=<id>.
// src/lib/capture/httpApi.ts stays agentless; CaptureApp calls this when an agent is set.
export class AgentNotFound extends Error {}

export async function createAgentCaptureSession(expert: string, agentId: string, fetcher: typeof fetch = fetch): Promise<string> {
  const res = await fetcher("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ kind: "capture", expert, agent_id: agentId }),
  });
  if (res.status === 404) throw new AgentNotFound("this agent was not found in your workspace");
  if (!res.ok) throw new Error(`/api/session ${res.status}`);
  return ((await res.json()) as { id: string }).id;
}
