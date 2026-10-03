import { getSession } from "@/lib/store";
import { exportGuardrailsMarkdown } from "@/lib/workmap";
import { badRequest, handle, notFound } from "../session/_http";

export const runtime = "nodejs";

export function GET(req: Request): Promise<Response> {
  return handle(async () => {
    const id = new URL(req.url).searchParams.get("session_id");
    if (!id) return badRequest("session_id is required");
    const session = await getSession(id);
    if (!session) return notFound(`session not found: ${id}`);
    if (!session.workmap) return notFound("no work map yet");
    return new Response(exportGuardrailsMarkdown(session.workmap), {
      headers: { "content-type": "text/markdown; charset=utf-8" },
    });
  });
}
