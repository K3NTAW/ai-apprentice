import { z } from "zod";
import { upsertQA } from "@/lib/store";
import { QAPairSchema } from "@/lib/types";
import { handle, parseBody, type IdContext } from "../../_http";

const Body = z.object({ qa: QAPairSchema });

export async function POST(req: Request, ctx: IdContext) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = await parseBody(req, Body);
    if (!body.ok) return body.res;
    const s = await upsertQA(id, body.data.qa);
    return Response.json({ ok: true, qa: s.qa.find((q) => q.id === body.data.qa.id) });
  });
}
