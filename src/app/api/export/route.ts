import { agentWorkMaps } from "@/lib/processes/merge";
import { listProcessesOrNone } from "@/lib/processes/server";
import type { SessionStore } from "@/lib/store";
import type { WorkMap } from "@/lib/types";
import { exportGuardrailsMarkdown } from "@/lib/workmap";
import { badRequest, notFound, withApi } from "../session/_http";

export const runtime = "nodejs";

const markdown = (body: string) => new Response(body, { headers: { "content-type": "text/markdown; charset=utf-8" } });

/** One heading level down, so each Work Map becomes a section of the agent export. */
const demote = (md: string) => md.replace(/^#/gm, "##");

/**
 * The agent's confirmed Work Maps, newest first: its confirmed, non-archived processes (titled by the process)
 * merged with its confirmed capture sessions not linked to any process (legacy Work Maps). While the processes
 * table is missing that is every confirmed capture session.
 */
async function confirmedMaps(store: SessionStore, agentId: string): Promise<WorkMap[]> {
  const [processes, sessions] = await Promise.all([listProcessesOrNone(store, { agent_id: agentId }), store.listSessionDigests()]);
  return agentWorkMaps(agentId, processes, sessions).map((m) => ({ ...m.workmap, task: m.title }));
}

// ?session_id=<id>: one Work Map. ?agent_id=<id>: every confirmed Work Map of the agent, one section per process
// (processes plus legacy confirmed sessions without a process).
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
