import { NextResponse } from "next/server";
import { WS_COOKIE, wsCookieOptions } from "@/lib/auth/cookies";
import { internalError, parseJsonBody, requireWorkspaceApi } from "@/lib/auth/context";
import { revalidateScopes } from "@/lib/cache/readMostly";
import { CreateWorkspaceInput, isMissingFunction } from "@/lib/workspace/create";

export const runtime = "nodejs";

/**
 * Creates a workspace through public.create_workspace (the user becomes its owner) and makes it the active one.
 * Any role may create. Local mode has one file-backed workspace: 400 local_mode, like the other workspace routes.
 * 503 until migration 20261004020000_workspace_create is applied.
 */
export async function POST(req: Request): Promise<Response> {
  const ctx = await requireWorkspaceApi();
  if (ctx instanceof Response) return ctx;
  const input = await parseJsonBody(req, CreateWorkspaceInput);
  if (input instanceof Response) return input;

  const { data, error } = await ctx.supabase.rpc("create_workspace", { p_name: input.name, p_city: input.city });
  if (error) {
    if (isMissingFunction(error.code)) {
      return Response.json({ error: "unavailable", message: "workspace creation not available yet" }, { status: 503 });
    }
    if (error.code === "22023") return Response.json({ error: "invalid_input" }, { status: 400 });
    if (error.code === "53400") return Response.json({ error: "workspace_limit" }, { status: 409 });
    return internalError("create_workspace", error);
  }
  if (typeof data !== "string" || !data) return internalError("create_workspace", null);

  revalidateScopes(["memberships"], { userId: ctx.userId, workspaceId: data });
  const res = NextResponse.json({ id: data }, { status: 201 });
  res.cookies.set(WS_COOKIE, data, wsCookieOptions());
  return res;
}
