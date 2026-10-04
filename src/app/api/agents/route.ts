import { requireRole } from "@/lib/auth/context";
import { parseBody, withApi, withMutation } from "../session/_http";
import { CreateAgentBody } from "./_lib";

export const runtime = "nodejs";

// Any member lists the agents of the active workspace.
export async function GET() {
  return withApi(async ({ store }) => Response.json({ agents: await store.listAgents() }));
}

// Owner or expert.
export async function POST(req: Request) {
  return withMutation(["agents"], async ({ ctx, store }) => {
    const denied = requireRole(ctx, ["owner", "expert"]);
    if (denied) return denied;
    const body = await parseBody(req, CreateAgentBody);
    if (!body.ok) return body.res;
    return Response.json(await store.createAgent(body.data), { status: 201 });
  });
}
