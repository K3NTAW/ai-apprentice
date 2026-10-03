import { z } from "zod";
import { TranscriptEntrySchema } from "@/lib/types";
import { parseBody, requireCreatorOrOwner, withApi, type IdContext } from "../../_http";

export const runtime = "nodejs";

// The store sets redacted itself, so clients may omit it.
const Body = z.object({
  entries: z.array(TranscriptEntrySchema.extend({ redacted: z.boolean().default(false) })),
});

export async function POST(req: Request, ctx: IdContext) {
  return withApi(async (api) => {
    const { id } = await ctx.params;
    const denied = await requireCreatorOrOwner(api, id);
    if (denied) return denied;
    const body = await parseBody(req, Body);
    if (!body.ok) return body.res;
    const s = await api.store.appendTranscript(id, body.data.entries);
    return Response.json({ ok: true, transcript: s.transcript.length });
  });
}
