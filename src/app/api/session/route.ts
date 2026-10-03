import { z } from "zod";
import { requireRole } from "@/lib/auth/context";
import { SessionSchema } from "@/lib/types";
import { parseBody, withApi } from "./_http";

export const runtime = "nodejs";

const CreateBody = z.object({ kind: SessionSchema.shape.kind, expert: z.string().optional() });

// capture: owner or expert. teach: any member.
export async function POST(req: Request) {
  return withApi(async ({ ctx, store }) => {
    const body = await parseBody(req, CreateBody);
    if (!body.ok) return body.res;
    if (body.data.kind === "capture") {
      const denied = requireRole(ctx, ["owner", "expert"]);
      if (denied) return denied;
    }
    return Response.json(await store.createSession(body.data), { status: 201 });
  });
}

// Any member lists every session of the active workspace; learners learn from capture sessions.
export async function GET() {
  return withApi(async ({ store }) => Response.json({ sessions: await store.listSessions() }));
}
