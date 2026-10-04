import { agentAdminFor } from "@/lib/agents/admin";
import { notFound, withApi, withMutation, type IdContext } from "../../../session/_http";
import { adminErrors } from "../../_lib";

export const runtime = "nodejs";

// Any member: what deleting the agent removes (processes, archived included, and training sessions of every kind)
// and whether this user may delete it (owner or creator, the DELETE rule). Feeds the delete confirm.
export async function GET(_req: Request, ctx: IdContext) {
  return withApi(async ({ ctx: rc, store }) => {
    const { id } = await ctx.params;
    const agent = await store.getAgent(id);
    if (!agent) return notFound(`agent not found: ${id}`);
    return adminErrors(async () => {
      const [processes, sessions, creator] = await Promise.all([
        store.listProcesses({ agent_id: agent.id, include_archived: true }).catch(() => []),
        store.listSessions(),
        agentAdminFor(rc).creatorOf(agent.id),
      ]);
      return Response.json({
        can_delete: rc.role === "owner" || (creator !== null && creator === rc.userId),
        processes: processes.length,
        sessions: sessions.filter((s) => s.agent_id === agent.id).length,
      });
    });
  });
}

// Any member asks the owner to delete the agent. One pending request per agent: a repeat answers the open one.
export async function POST(_req: Request, ctx: IdContext) {
  return withMutation(["agents"], async ({ ctx: rc, store }) => {
    const { id } = await ctx.params;
    const agent = await store.getAgent(id);
    if (!agent) return notFound(`agent not found: ${id}`);
    return adminErrors(async () => Response.json(await agentAdminFor(rc).requestDeletion(agent.id, agent.name), { status: 201 }));
  });
}
