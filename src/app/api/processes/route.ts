import { requireRole } from "@/lib/auth/context";
import { parseBody, withApi, withMutation } from "../session/_http";
import { agentErrors } from "../agents/_lib";
import { CreateProcessBody } from "./_lib";

export const runtime = "nodejs";

// Any member. ?agent_id=<id> narrows to one agent; ?archived=1 includes archived processes.
// 503 processes_unavailable until the migration is applied; the caller falls back to sessions.
export async function GET(req: Request) {
  return withApi(async ({ store }) => {
    const params = new URL(req.url).searchParams;
    const agentId = params.get("agent_id") ?? undefined;
    const processes = await store.listProcesses({ agent_id: agentId, include_archived: params.get("archived") === "1" });
    return Response.json({ processes });
  });
}

// Owner or expert.
export async function POST(req: Request) {
  return withMutation(["agents", "sessions"], async ({ ctx, store }) => {
    const denied = requireRole(ctx, ["owner", "expert"]);
    if (denied) return denied;
    const body = await parseBody(req, CreateProcessBody);
    if (!body.ok) return body.res;
    return agentErrors(async () => Response.json(await store.createProcess(body.data), { status: 201 }));
  });
}
