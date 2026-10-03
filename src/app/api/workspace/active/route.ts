import { NextResponse } from "next/server";
import { z } from "zod";
import { WS_COOKIE, wsCookieOptions } from "@/lib/auth/cookies";
import { parseJsonBody, requireWorkspaceApi } from "@/lib/auth/context";

export const runtime = "nodejs";

const SetActive = z.object({ workspaceId: z.guid() });

export async function POST(req: Request): Promise<Response> {
  const ctx = await requireWorkspaceApi();
  if (ctx instanceof Response) return ctx;
  const input = await parseJsonBody(req, SetActive);
  if (input instanceof Response) return input;

  if (!ctx.memberships.some((m) => m.workspaceId === input.workspaceId)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set(WS_COOKIE, input.workspaceId, wsCookieOptions());
  return res;
}
