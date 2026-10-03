// Workspace invites. No email is sent: the invitee requests their own magic link and
// bootstrap_workspace accepts the invite at their next callback login.
import { z } from "zod";
import { internalError, parseJsonBody, requireWorkspaceApi } from "@/lib/auth/context";

export const runtime = "nodejs";

const CreateInvite = z.object({
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: z.enum(["expert", "learner"]),
});

const RevokeInvite = z.object({ id: z.guid() });

export async function POST(req: Request): Promise<Response> {
  const ctx = await requireWorkspaceApi(["owner"]);
  if (ctx instanceof Response) return ctx;
  const input = await parseJsonBody(req, CreateInvite);
  if (input instanceof Response) return input;

  const { data, error } = await ctx.supabase
    .from("workspace_invites")
    .insert({ workspace_id: ctx.workspaceId, email: input.email, role: input.role, invited_by: ctx.userId })
    .select();
  if (error) {
    if (error.code === "23505") return Response.json({ error: "invite_exists" }, { status: 409 });
    return internalError("invites POST", error);
  }
  if (!data || data.length === 0) return internalError("invites POST", null);
  return Response.json(data[0], { status: 201 });
}

export async function DELETE(req: Request): Promise<Response> {
  const ctx = await requireWorkspaceApi(["owner"]);
  if (ctx instanceof Response) return ctx;
  const input = await parseJsonBody(req, RevokeInvite);
  if (input instanceof Response) return input;

  const { data, error } = await ctx.supabase
    .from("workspace_invites")
    .delete()
    .eq("id", input.id)
    .eq("workspace_id", ctx.workspaceId)
    .is("accepted_at", null)
    .select();
  if (error) return internalError("invites DELETE", error);
  if (!data || data.length === 0) return Response.json({ error: "not_found" }, { status: 404 });
  return Response.json({ ok: true });
}
