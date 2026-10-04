import { fileDataPort, supabaseDataPort } from "@/lib/agents/admin";
import { isEmptySession } from "@/lib/capture/empty";
import { deleteSessionsWithFrames } from "@/lib/capture/emptyPurge";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { notFound, requireCreatorOrOwner, withApi, withMutation, type IdContext } from "../_http";

export const runtime = "nodejs";

// Any member reads any session of the active workspace.
export async function GET(_req: Request, ctx: IdContext) {
  return withApi(async ({ store }) => {
    const { id } = await ctx.params;
    const s = await store.getSession(id);
    return s ? Response.json(s) : notFound();
  });
}

// Delete an empty capture run ('No work recorded', lib/capture/empty): the creator or an owner, 204.
// Any other session answers 409 not_empty and stays. Frames go from Storage first, then the row (children cascade);
// supabase mode deletes with the service role, scoped to the active workspace, after the checks above.
export async function DELETE(_req: Request, ctx: IdContext) {
  return withMutation(["sessions"], async (api) => {
    const { id } = await ctx.params;
    const denied = await requireCreatorOrOwner(api, id);
    if (denied) return denied;
    const s = await api.store.getSession(id);
    if (!s) return notFound();
    if (!isEmptySession(s)) return Response.json({ error: "not_empty", message: "only an empty run can be deleted" }, { status: 409 });
    const port = api.ctx.supabase ? supabaseDataPort(createSupabaseAdminClient(), api.ctx.workspaceId) : fileDataPort();
    await deleteSessionsWithFrames(port, [id]);
    return new Response(null, { status: 204 });
  });
}
