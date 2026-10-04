import { agentAdminFor } from "@/lib/agents/admin";
import { notFound, withMutation, type IdContext } from "../../../session/_http";
import { adminErrors } from "../../_lib";

export const runtime = "nodejs";

// Any member asks the owner to delete the agent. One pending request per agent: a repeat answers the open one.
export async function POST(_req: Request, ctx: IdContext) {
  return withMutation(["agents"], async ({ ctx: rc, store }) => {
    const { id } = await ctx.params;
    const agent = await store.getAgent(id);
    if (!agent) return notFound(`agent not found: ${id}`);
    return adminErrors(async () => Response.json(await agentAdminFor(rc).requestDeletion(agent.id, agent.name), { status: 201 }));
  });
}
