import { requireCreatorOrOwner, withMutation, type IdContext } from "../../_http";

export const runtime = "nodejs";

export async function POST(_req: Request, ctx: IdContext) {
  return withMutation(["sessions"], async (api) => {
    const { id } = await ctx.params;
    const denied = await requireCreatorOrOwner(api, id);
    if (denied) return denied;
    return Response.json(await api.store.endSession(id));
  });
}
