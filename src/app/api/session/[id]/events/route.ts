import { z } from "zod";
import { appendEvents } from "@/lib/store";
import { ScreenEventSchema } from "@/lib/types";
import { handle, parseBody, type IdContext } from "../../_http";

const Body = z.object({ events: z.array(ScreenEventSchema) });

export async function POST(req: Request, ctx: IdContext) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = await parseBody(req, Body);
    if (!body.ok) return body.res;
    const s = await appendEvents(id, body.data.events);
    return Response.json({ ok: true, events: s.events.length });
  });
}
