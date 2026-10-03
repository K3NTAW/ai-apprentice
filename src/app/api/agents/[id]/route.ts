import { requireRole } from "@/lib/auth/context";
import { notFound, parseBody, withApi, type IdContext } from "../../session/_http";
import { agentErrors, PatchAgentBody } from "../_lib";

export const runtime = "nodejs";

// Any member reads an agent of the active workspace; other workspaces answer 404.
export async function GET(_req: Request, ctx: IdContext) {
  return withApi(async ({ store }) => {
    const { id } = await ctx.params;
    const agent = await store.getAgent(id);
    return agent ? Response.json(agent) : notFound(`agent not found: ${id}`);
  });
}

// Owner or expert.
export async function PATCH(req: Request, ctx: IdContext) {
  return withApi(async ({ ctx: rc, store }) => {
    const denied = requireRole(rc, ["owner", "expert"]);
    if (denied) return denied;
    const { id } = await ctx.params;
    const body = await parseBody(req, PatchAgentBody);
    if (!body.ok) return body.res;
    return agentErrors(async () => Response.json(await store.updateAgent(id, body.data)));
  });
}

// Owner only. Sessions of the agent keep their history with agent_id cleared.
export async function DELETE(_req: Request, ctx: IdContext) {
  return withApi(async ({ ctx: rc, store }) => {
    const denied = requireRole(rc, ["owner"]);
    if (denied) return denied;
    const { id } = await ctx.params;
    return (await store.deleteAgent(id)) ? new Response(null, { status: 204 }) : notFound(`agent not found: ${id}`);
  });
}
