import { z } from "zod";
import { setOffRecord } from "@/lib/store";
import { handle, parseBody, type IdContext } from "../../_http";

const Body = z.object({ from: z.number(), to: z.number().optional() });

export async function POST(req: Request, ctx: IdContext) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = await parseBody(req, Body);
    if (!body.ok) return body.res;
    const s = await setOffRecord(id, body.data);
    return Response.json({ ok: true, off_record_ranges: s.off_record_ranges });
  });
}
