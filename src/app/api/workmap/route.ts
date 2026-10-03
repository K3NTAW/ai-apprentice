import { z } from "zod";
import { gaps, isUnderstood, scoreWorkMap, synthesizeWorkMap, teachBackText } from "@/lib/workmap";
import { notFound, parseBody, requireCreatorOrOwner, withApi } from "../session/_http";

export const runtime = "nodejs";

const Body = z.object({ session_id: z.string(), rescore_only: z.boolean().optional() });

export function POST(req: Request): Promise<Response> {
  return withApi(async (api) => {
    const body = await parseBody(req, Body);
    if (!body.ok) return body.res;
    const { session_id, rescore_only } = body.data;
    const denied = await requireCreatorOrOwner(api, session_id);
    if (denied) return denied;
    const session = await api.store.getSession(session_id);
    if (!session) return notFound(`session not found: ${session_id}`);
    const base = rescore_only && session.workmap ? session.workmap : await synthesizeWorkMap(session);
    const workmap = await scoreWorkMap(base, session);
    await api.store.saveWorkMap(session_id, workmap);
    return Response.json({
      workmap,
      gaps: gaps(workmap, session),
      understood: isUnderstood(workmap),
      teach_back: teachBackText(workmap),
    });
  });
}
