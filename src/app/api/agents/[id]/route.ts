import { requireRole } from "@/lib/auth/context";
import { notFound, parseBody, withApi, withMutation, type IdContext } from "../../session/_http";
import { agentAdminFor } from "@/lib/agents/admin";
import { isValidAgentId } from "@/lib/store";
import { adminErrors, agentErrors, PatchAgentBody } from "../_lib";

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
  return withMutation(["agents"], async ({ ctx: rc, store }) => {
    const denied = requireRole(rc, ["owner", "expert"]);
    if (denied) return denied;
    const { id } = await ctx.params;
    const body = await parseBody(req, PatchAgentBody);
    if (!body.ok) return body.res;
    return agentErrors(async () => Response.json(await store.updateAgent(id, body.data)));
  });
}

// Owner only. Frames (Storage, then rows), a report row with the teach sessions, the capture sessions, then the
// agent (contract in src/lib/agents/admin.ts). Teach sessions stay with agent_id cleared.
export async function DELETE(_req: Request, ctx: IdContext) {
  return withMutation(["agents", "sessions"], async ({ ctx: rc }) => {
    const denied = requireRole(rc, ["owner"]);
    if (denied) return denied;
    const { id } = await ctx.params;
    if (!isValidAgentId(id)) return notFound(`agent not found: ${id}`);
    return adminErrors(async () => {
      const res = await agentAdminFor(rc).deleteAgentWithData(id);
      return res.deleted ? new Response(null, { status: 204 }) : notFound(`agent not found: ${id}`);
    });
  });
}
