import { endSession } from "@/lib/store";
import { handle, type IdContext } from "../../_http";

export async function POST(_req: Request, ctx: IdContext) {
  return handle(async () => {
    const { id } = await ctx.params;
    return Response.json(await endSession(id));
  });
}
