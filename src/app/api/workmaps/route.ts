// GET /api/workmaps: the workspace's capture Work Maps in one request (Work Map list, Teach picker and loader).
// (POST /api/workmap synthesizes one map; this list endpoint is plural on purpose.)
// ?confirmed=1: confirmed maps only. ?agent_id=<uuid>: that agent's maps; an unknown, malformed or other-workspace
// agent answers 404. ?session_id=<id>: also returns that session's map, confirmed or not, as `session`.
// ?limit=1..200, default 50. Sorted by started_at then id, newest first. Response: { maps, session }.
import { isValidSessionId } from "@/lib/store";
import { parseLimit, workMapItems } from "@/lib/workmap/items";
import { badRequest, notFound, withApi } from "../session/_http";

export const runtime = "nodejs";

export function GET(req: Request): Promise<Response> {
  return withApi(async ({ store }) => {
    const params = new URL(req.url).searchParams;
    const limit = parseLimit(params.get("limit"));
    if (limit === null) return badRequest("invalid limit");
    const sessionId = params.get("session_id");
    if (sessionId !== null && !isValidSessionId(sessionId)) return badRequest("invalid session_id");
    const agentId = params.get("agent_id");
    const [agent, digests] = await Promise.all([agentId ? store.getAgent(agentId) : null, store.listSessionDigests()]);
    if (agentId && !agent) return notFound(`agent not found: ${agentId}`);
    return Response.json(workMapItems(digests, { confirmed: params.get("confirmed") === "1", agentId, sessionId, limit }));
  });
}
