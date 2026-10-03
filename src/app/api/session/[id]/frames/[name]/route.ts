import { isValidFrameName, isValidSessionId, readFrame } from "@/lib/store";
import { badRequest, notFound } from "../../../_http";

export async function GET(_req: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await ctx.params;
  if (!isValidSessionId(id) || !isValidFrameName(name)) return badRequest("invalid frame path");
  const buf = await readFrame(id, name);
  if (!buf) return notFound();
  return new Response(new Uint8Array(buf), {
    headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" },
  });
}
