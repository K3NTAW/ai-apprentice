import { z } from "zod";
import { gaps, isUnderstood, rebuildWorkMap, teachBackText } from "@/lib/workmap";
import { consumeUsage } from "@/lib/usage";
import { notFound, parseBody, requireCreatorOrOwner, withApi } from "../session/_http";

export const runtime = "nodejs";
// Vercel function limit: 60 s fits the plan (model calls can take tens of seconds).
export const maxDuration = 60;

const Body = z.object({ session_id: z.string(), rescore_only: z.boolean().optional() });

export function POST(req: Request): Promise<Response> {
  return withApi(async (api) => {
    // Daily synthesis cap per workspace (429 daily_limit). workmap/confirm is not counted.
    const usage = await consumeUsage(api.ctx, "workmap");
    if (usage instanceof Response) return usage;
    const body = await parseBody(req, Body);
    if (!body.ok) return body.res;
    const { session_id, rescore_only } = body.data;
    const denied = await requireCreatorOrOwner(api, session_id);
    if (denied) return denied;
    const session = await api.store.getSession(session_id);
    if (!session) return notFound(`session not found: ${session_id}`);
    // Rescore only between debrief answers; a full rebuild past its budget keeps the last map (rescored).
    const { workmap, mode } = await rebuildWorkMap(session, { rescoreOnly: rescore_only });
    await api.store.saveWorkMap(session_id, workmap);
    return Response.json({
      workmap,
      gaps: gaps(workmap, session),
      understood: isUnderstood(workmap),
      teach_back: teachBackText(workmap),
      mode,
    });
  });
}
