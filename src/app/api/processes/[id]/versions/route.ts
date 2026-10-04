import { notFound, withApi, type IdContext } from "../../../session/_http";

export const runtime = "nodejs";

// Any member: the version history of a process, newest first.
export async function GET(_req: Request, ctx: IdContext) {
  return withApi(async ({ store }) => {
    const { id } = await ctx.params;
    if (!(await store.getProcess(id))) return notFound(`process not found: ${id}`);
    return Response.json({ versions: await store.listProcessVersions(id) });
  });
}
