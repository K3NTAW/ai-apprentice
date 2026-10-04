import { ProcessesUnavailableError, type SessionStore } from "@/lib/store";
import type { WorkMap } from "@/lib/types";
import { exportGuardrailsMarkdown } from "@/lib/workmap";
import { badRequest, notFound, withApi } from "../session/_http";

export const runtime = "nodejs";

const markdown = (body: string) => new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });

/** One heading level down, so each Work Map becomes a section of the agent export. */
const demote = (md: string) => md.replace(/^#/gm, "##");

/**
 * The agent's confirmed Work Maps, newest first (same order as the agent page). From its confirmed, non-archived
 * processes (titled by the process) when the agent has any; else, and while the processes table is missing,
 * from its confirmed capture sessions.
 */
async function confirmedMaps(store: SessionStore, agentId: string): Promise<WorkMap[]> {
  const processes = await store.listProcesses({ agent_id: agentId, include_archived: true }).catch((err: unknown) => {
    if (err instanceof ProcessesUnavailableError) return [];
    throw err;
  });
  if (processes.length > 0)
    return processes.filter((p) => p.confirmed && !p.archived_at).map((p) => ({ ...p.workmap, task: p.title }));
  return (await store.listSessionDigests())
    .filter((s) => s.agent_id === agentId && s.kind === "capture" && s.workmap?.confirmed_by_expert === true)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at) || a.id.localeCompare(b.id))
    .map((s) => s.workmap!);
}

// ?session_id=<id>: one Work Map. ?agent_id=<id>: every confirmed Work Map of the agent, one section per process
// (processes when the agent has them, else confirmed capture sessions).
// Both are scoped to the active workspace; an agent or session of another workspace answers 404.
export function GET(req: Request): Promise<Response> {
  return withApi(async ({ store }) => {
    const params = new URL(req.url).searchParams;
    const agentId = params.get("agent_id");
    if (agentId) {
      const agent = await store.getAgent(agentId);
      if (!agent) return notFound(`agent not found: ${agentId}`);
      const maps = await confirmedMaps(store, agent.id);
      if (maps.length === 0) return notFound("no confirmed work map yet");
      const sections = maps.map((m) => demote(exportGuardrailsMarkdown(m)).trimEnd());
      return markdown([`# Guardrails: ${agent.name}`, "", ...sections.flatMap((s) => [s, ""])].join("\n"));
    }
    const id = params.get("session_id");
    if (!id) return badRequest("session_id or agent_id is required");
    const session = await store.getSession(id);
    if (!session) return notFound(`session not found: ${id}`);
    if (!session.workmap) return notFound("no work map yet");
    return markdown(exportGuardrailsMarkdown(session.workmap));
  });
}
