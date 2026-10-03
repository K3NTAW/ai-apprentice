// Teach with an agent (amendment A4): ?agent is the agent of the new teach session (agent_id);
// ?session is the source Work Map capture session, which must belong to that agent.
import { teachSourceError } from "@/components/agents/model";
import type { Session } from "@/lib/types";

/** Error text when the Work Map session does not belong to the agent (or is not found), else null. */
export async function checkTeachSource(agentId: string, sessionId: string, fetcher: typeof fetch = fetch): Promise<string | null> {
  try {
    const res = await fetcher(`/api/session/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
    if (res.status === 404) return teachSourceError(agentId, null);
    if (!res.ok) return "The Work Map could not be checked. Reload the page to try again.";
    return teachSourceError(agentId, (await res.json()) as Session);
  } catch {
    return "The Work Map could not be checked. Reload the page to try again.";
  }
}

/** Body of POST /api/session for the new teach session. */
export const teachSessionBody = (agentId: string | null) => (agentId ? { kind: "teach", agent_id: agentId } : { kind: "teach" });
