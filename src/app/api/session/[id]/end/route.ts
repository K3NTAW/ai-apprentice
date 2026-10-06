import { requireCreatorOrOwner, withMutation, type IdContext } from "../../_http";

export const runtime = "nodejs";

export async function POST(req: Request, ctx: IdContext) {
  return withMutation(["sessions"], { route: "/api/session/[id]/end", req }, async (api) => {
    const { id } = await ctx.params;
    const denied = await requireCreatorOrOwner(api, id);
    if (denied) return denied;
    return Response.json(await api.store.endSession(id));
  });
}
