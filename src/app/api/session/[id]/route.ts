import { getSession } from "@/lib/store";
import { handle, notFound, type IdContext } from "../_http";

export async function GET(_req: Request, ctx: IdContext) {
  return handle(async () => {
    const { id } = await ctx.params;
    const s = await getSession(id);
    return s ? Response.json(s) : notFound();
  });
}
