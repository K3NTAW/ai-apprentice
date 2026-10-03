import { z } from "zod";
import { parseBody, requireCreatorOrOwner, withApi, type IdContext } from "../../_http";

const Body = z.object({ from: z.number(), to: z.number().optional() });

export async function POST(req: Request, ctx: IdContext) {
  return withApi(async (api) => {
    const { id } = await ctx.params;
    const denied = await requireCreatorOrOwner(api, id);
    if (denied) return denied;
    const body = await parseBody(req, Body);
    if (!body.ok) return body.res;
    const s = await api.store.setOffRecord(id, body.data);
    return Response.json({ ok: true, off_record_ranges: s.off_record_ranges });
  });
}
