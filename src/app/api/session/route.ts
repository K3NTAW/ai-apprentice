import { z } from "zod";
import { createSession, listSessions } from "@/lib/store";
import { SessionSchema } from "@/lib/types";
import { parseBody } from "./_http";

const CreateBody = z.object({ kind: SessionSchema.shape.kind, expert: z.string().optional() });

export async function POST(req: Request) {
  const body = await parseBody(req, CreateBody);
  if (!body.ok) return body.res;
  return Response.json(await createSession(body.data));
}

export async function GET() {
  return Response.json({ sessions: await listSessions() });
}
