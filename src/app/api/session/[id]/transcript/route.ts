import { z } from "zod";
import { appendTranscript } from "@/lib/store";
import { TranscriptEntrySchema } from "@/lib/types";
import { handle, parseBody, type IdContext } from "../../_http";

// The store sets redacted itself, so clients may omit it.
const Body = z.object({
  entries: z.array(TranscriptEntrySchema.extend({ redacted: z.boolean().default(false) })),
});

export async function POST(req: Request, ctx: IdContext) {
  return handle(async () => {
    const { id } = await ctx.params;
    const body = await parseBody(req, Body);
    if (!body.ok) return body.res;
    const s = await appendTranscript(id, body.data.entries);
    return Response.json({ ok: true, transcript: s.transcript.length });
  });
}
