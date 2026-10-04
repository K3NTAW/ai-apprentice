import { z } from "zod";
import { TEACH_LIST_MAX, TeachProgressSchema } from "@/lib/types";
import { parseBody, requireCreatorOrOwner, withMutation, type IdContext } from "../../_http";

export const runtime = "nodejs";

const BodySchema = z.object({ teach: TeachProgressSchema }).strict();

/**
 * Saves the teach progress of a teach session (sessions.teach): the session creator or a workspace owner.
 * Mastered steps are unioned with the stored list for the same Work Map. 503 teach_unavailable while
 * migration 20261004040000_session_teach is not applied.
 */
export async function POST(req: Request, ctx: IdContext) {
  return withMutation(["sessions"], async (api) => {
    const { id } = await ctx.params;
    const denied = await requireCreatorOrOwner(api, id);
    if (denied) return denied;
    const body = await parseBody(req, BodySchema);
    if (!body.ok) return body.res;
    const { teach } = body.data;
    const stored = (await api.store.getSession(id))?.teach;
    const mastered =
      stored && stored.workmap_session_id === teach.workmap_session_id ? [...new Set([...stored.mastered, ...teach.mastered])] : teach.mastered;
    const saved = await api.store.saveTeach(id, { ...teach, mastered: mastered.slice(0, TEACH_LIST_MAX) });
    return Response.json({ id: saved.id, teach: saved.teach });
  });
}
