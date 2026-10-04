import { z } from "zod";
import { internalError, parseJsonBody, requireWorkspaceApi } from "@/lib/auth/context";
import { revalidateScopes } from "@/lib/cache/readMostly";

export const runtime = "nodejs";

const RemoveMember = z.object({ userId: z.guid() });

// The last-owner rule lives in the database trigger, not here. Its errcode (42501) is
// shared with other guards, so the message is checked too before answering last_owner.
function isLastOwnerError(error: { code?: string; message?: string }): boolean {
  return (error.code === "42501" || error.code === "P0001") && /would have no owner/i.test(error.message ?? "");
}

export async function DELETE(req: Request): Promise<Response> {
  const ctx = await requireWorkspaceApi(["owner"]);
  if (ctx instanceof Response) return ctx;
  const input = await parseJsonBody(req, RemoveMember);
  if (input instanceof Response) return input;

  const { data, error } = await ctx.supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", ctx.workspaceId)
    .eq("user_id", input.userId)
    .select();
  if (error) {
    if (isLastOwnerError(error)) return Response.json({ error: "last_owner" }, { status: 409 });
    return internalError("members DELETE", error);
  }
  if (!data || data.length === 0) return Response.json({ error: "not_found" }, { status: 404 });
  // The removed user's cached memberships and this workspace's member list (agents and control room input).
  revalidateScopes(["memberships"], { userId: input.userId, workspaceId: ctx.workspaceId });
  revalidateScopes(["members"], ctx);
  return Response.json({ ok: true });
}
