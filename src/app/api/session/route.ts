import { z } from "zod";
import { requireRole } from "@/lib/auth/context";
import { AgentNotFoundError } from "@/lib/store";
import { SessionSchema } from "@/lib/types";
import { notFound, parseBody, withApi } from "./_http";

export const runtime = "nodejs";

const CreateBody = z.object({
  kind: SessionSchema.shape.kind,
  expert: z.string().optional(),
  agent_id: z.uuid().optional(),
});

// capture: owner or expert. teach: any member.
export async function POST(req: Request) {
  return withApi(async ({ ctx, store }) => {
    const body = await parseBody(req, CreateBody);
    if (!body.ok) return body.res;
    if (body.data.kind === "capture") {
      const denied = requireRole(ctx, ["owner", "expert"]);
      if (denied) return denied;
    }
    // agent_id must name an agent of the active workspace; any other id answers 404.
    try {
      return Response.json(await store.createSession(body.data), { status: 201 });
    } catch (err) {
      if (err instanceof AgentNotFoundError) return notFound(err.message);
      throw err;
    }
  });
}

// Any member lists every session of the active workspace; learners learn from capture sessions.
export async function GET() {
  return withApi(async ({ store }) => Response.json({ sessions: await store.listSessions() }));
}
