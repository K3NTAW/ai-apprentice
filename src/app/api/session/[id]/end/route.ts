import { requireCreatorOrOwner, withApi, type IdContext } from "../../_http";

export async function POST(_req: Request, ctx: IdContext) {
  return withApi(async (api) => {
    const { id } = await ctx.params;
    const denied = await requireCreatorOrOwner(api, id);
    if (denied) return denied;
    return Response.json(await api.store.endSession(id));
  });
}
