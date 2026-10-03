import { notFound, withApi, type IdContext } from "../_http";

// Any member reads any session of the active workspace.
export async function GET(_req: Request, ctx: IdContext) {
  return withApi(async ({ store }) => {
    const { id } = await ctx.params;
    const s = await store.getSession(id);
    return s ? Response.json(s) : notFound();
  });
}
