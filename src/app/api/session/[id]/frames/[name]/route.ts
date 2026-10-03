import { isValidFrameName, isValidSessionId } from "@/lib/store";
import { badRequest, notFound, withApi } from "../../../_http";

export const runtime = "nodejs";

// Supabase mode: the store reads the private 'frames' bucket (<workspaceId>/<sessionId>/<name>) through the
// user-scoped client, so Storage RLS applies. Local mode: the file store reads data/sessions/<id>/frames.
// The session-existence check keeps a foreign session at 404.
export async function GET(_req: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  return withApi(async ({ store }) => {
    const { id, name } = await ctx.params;
    if (!isValidSessionId(id) || !isValidFrameName(name)) return badRequest("invalid frame path");
    if (!(await store.getSession(id))) return notFound();
    const buf = await store.readFrame(id, name);
    if (!buf) return notFound();
    return new Response(new Uint8Array(buf), {
      headers: { "content-type": "image/jpeg", "cache-control": "private, no-store" },
    });
  });
}
