import { z } from "zod";
import { ScreenEventSchema } from "@/lib/types";
import { parseBody, requireCreatorOrOwner, withApi, type IdContext } from "../../_http";

const Body = z.object({ events: z.array(ScreenEventSchema) });

export async function POST(req: Request, ctx: IdContext) {
  return withApi(async (api) => {
    const { id } = await ctx.params;
    const denied = await requireCreatorOrOwner(api, id);
    if (denied) return denied;
    const body = await parseBody(req, Body);
    if (!body.ok) return body.res;
    const s = await api.store.appendEvents(id, body.data.events);
    return Response.json({ ok: true, events: s.events.length });
  });
}
