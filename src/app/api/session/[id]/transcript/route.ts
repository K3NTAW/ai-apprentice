import { z } from "zod";
import { TranscriptEntrySchema } from "@/lib/types";
import { parseBody, requireCreatorOrOwner, withApi, type IdContext } from "../../_http";

export const runtime = "nodejs";

// The store sets redacted itself, so clients may omit it. Batches of at most MAX_ENTRIES, each text at most
// MAX_TEXT chars (the capture page clips at 2000 and posts one final utterance at a time).
const MAX_ENTRIES = 50;
const MAX_TEXT = 4000;
const Body = z.object({
  entries: z.array(TranscriptEntrySchema.extend({ text: z.string().max(MAX_TEXT), redacted: z.boolean().default(false) })).max(MAX_ENTRIES),
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
