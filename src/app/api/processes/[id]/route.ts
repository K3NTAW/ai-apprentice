import { requireRole } from "@/lib/auth/context";
import { notFound, parseBody, withApi, withMutation, type IdContext } from "../../session/_http";
import { PatchProcessBody } from "../_lib";

export const runtime = "nodejs";

// Any member reads a process of the active workspace; other workspaces answer 404.
export async function GET(_req: Request, ctx: IdContext) {
  return withApi(async ({ store }) => {
    const { id } = await ctx.params;
    const process = await store.getProcess(id);
    return process ? Response.json(process) : notFound(`process not found: ${id}`);
  });
}

// Owner or expert: rename, edit the Work Map (new version), confirm, archive or restore.
export async function PATCH(req: Request, ctx: IdContext) {
  return withMutation(["agents", "sessions"], async ({ ctx: rc, store }) => {
    const denied = requireRole(rc, ["owner", "expert"]);
    if (denied) return denied;
    const { id } = await ctx.params;
    const body = await parseBody(req, PatchProcessBody);
    if (!body.ok) return body.res;
    return Response.json(await store.updateProcess(id, body.data));
  });
}

// Owner only. Versions go with the process; linked sessions stay with process_id cleared.
export async function DELETE(_req: Request, ctx: IdContext) {
  return withMutation(["agents", "sessions"], async ({ ctx: rc, store }) => {
    const denied = requireRole(rc, ["owner"]);
    if (denied) return denied;
    const { id } = await ctx.params;
    return (await store.deleteProcess(id)) ? new Response(null, { status: 204 }) : notFound(`process not found: ${id}`);
  });
}
