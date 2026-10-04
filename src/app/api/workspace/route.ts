import { NextResponse } from "next/server";
import { WS_COOKIE, wsCookieOptions } from "@/lib/auth/cookies";
import { internalError, parseJsonBody, requireWorkspaceApi } from "@/lib/auth/context";
import { revalidateScopes } from "@/lib/cache/readMostly";
import { CreateWorkspaceInput, isMissingFunction, RenameWorkspaceInput } from "@/lib/workspace/create";

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

/**
 * Renames the active workspace and sets or clears its city. Owner only (requireRole); the workspaces update policy
 * allows owners too, so a row that does not update means the policy refused it. Local mode: 400 local_mode.
 */
export async function PATCH(req: Request): Promise<Response> {
  const ctx = await requireWorkspaceApi(["owner"]);
  if (ctx instanceof Response) return ctx;
  const input = await parseJsonBody(req, RenameWorkspaceInput);
  if (input instanceof Response) return input;

  const patch = input.city === undefined ? { name: input.name } : { name: input.name, city: input.city };
  const { data, error } = await ctx.supabase.from("workspaces").update(patch).eq("id", ctx.workspaceId).select("id, name, city");
  if (error) {
    // 42703: workspaces.city does not exist yet (migration 20261004020000 not applied).
    if (error.code === "42703") return Response.json({ error: "unavailable", message: "workspace city not available yet" }, { status: 503 });
    return internalError("workspace PATCH", error);
  }
  if (!data || data.length === 0) return Response.json({ error: "not_found" }, { status: 404 });

  // The sidebar and shell read the name and city through the cached memberships.
  revalidateScopes(["memberships"], ctx);
  return Response.json(data[0]);
}
