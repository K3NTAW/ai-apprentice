import { z } from "zod";
import { redactText } from "@/lib/redact";
import { notFound, parseBody, requireCreatorOrOwner, withMutation } from "../../session/_http";

export const runtime = "nodejs";
// Vercel function limit: 60 s fits the plan (model calls can take tens of seconds).
export const maxDuration = 60;

const Body = z.object({ session_id: z.string(), confirmed: z.boolean(), correction: z.string().optional() });

export function POST(req: Request): Promise<Response> {
  return withMutation(["sessions"], async (api) => {
    const body = await parseBody(req, Body);
    if (!body.ok) return body.res;
    const { session_id, confirmed } = body.data;
    // Session creator or a workspace owner.
    const denied = await requireCreatorOrOwner(api, session_id);
    if (denied) return denied;
    const session = await api.store.getSession(session_id);
    if (!session) return notFound(`session not found: ${session_id}`);
    if (!session.workmap) return Response.json({ error: "no work map yet" }, { status: 409 });
    const first = session.expert?.trim().split(/\s+/)[0];
    const correction = body.data.correction?.trim();
    const workmap = { ...session.workmap, open_questions: [...session.workmap.open_questions] };
    if (correction) {
      const clean = redactText(correction, first ? { keepNames: [first] } : {}).text;
      workmap.open_questions.push(`Correction from expert: ${clean}`);
      workmap.confirmed_by_expert = false;
    } else {
      workmap.confirmed_by_expert = confirmed;
    }
    await api.store.saveWorkMap(session_id, workmap);
    return Response.json({ workmap });
  });
}
