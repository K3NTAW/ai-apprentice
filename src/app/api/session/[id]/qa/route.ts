import { z } from "zod";
import { QAPairSchema } from "@/lib/types";
import { parseBody, requireCreatorOrOwner, withApi, type IdContext } from "../../_http";

const Body = z.object({ qa: QAPairSchema });

export async function POST(req: Request, ctx: IdContext) {
  return withApi(async (api) => {
    const { id } = await ctx.params;
    const denied = await requireCreatorOrOwner(api, id);
    if (denied) return denied;
    const body = await parseBody(req, Body);
    if (!body.ok) return body.res;
    const s = await api.store.upsertQA(id, body.data.qa);
    return Response.json({ ok: true, qa: s.qa.find((q) => q.id === body.data.qa.id) });
  });
}
