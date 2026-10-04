import { redirect } from "next/navigation";
import {
  buildWorkspaceView,
  emailLookupIds,
  getRequestContext,
  MEMBER_DISPLAY_LIMIT,
  type InviteRowInput,
  type MemberRowInput,
} from "@/lib/auth/context";
import AppShell from "@/components/shell/AppShell";
import { lookupEmails } from "./emails";
import WorkspaceClient from "./WorkspaceClient";

export const dynamic = "force-dynamic";

function Message({ title, text }: { title: string; text: string }) {
  return (
    <main className="flex flex-col gap-2 p-8">
      <h1 className="text-lg font-semibold">{title}</h1>
      <p>{text}</p>
    </main>
  );
}

export default async function WorkspacePage() {
  return <AppShell>{await workspaceBody()}</AppShell>;
}

async function workspaceBody() {
  const result = await getRequestContext();
  if (result.kind === "signed_out") redirect("/login?next=/workspace");
  if (result.kind === "misconfigured") return <Message title="Workspace" text="Sign-in is not configured on this deployment." />;
  if (result.kind === "no_workspace") return <Message title="Workspace" text="Your workspace could not be loaded. Try signing in again." />;

  const { ctx } = result;
  if (ctx.mode === "local" || !ctx.supabase) {
    return <Message title="Workspace" text="Local mode, no workspaces." />;
  }

  const supabase = ctx.supabase;
  const membersQuery = supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: true })
    .order("user_id", { ascending: true })
    .limit(MEMBER_DISPLAY_LIMIT + 1);
  const invitesQuery =
    ctx.role === "owner"
      ? supabase
          .from("workspace_invites")
          .select("id, email, role, created_at")
          .eq("workspace_id", ctx.workspaceId)
          .is("accepted_at", null)
          .order("created_at", { ascending: true })
      : null;
  const [members, invites] = await Promise.all([membersQuery, invitesQuery]);
  if (members.error || invites?.error) {
    console.error("workspace page:", members.error?.message ?? invites?.error?.message);
    return <Message title="Workspace" text="The workspace could not be loaded. Try again." />;
  }

  const memberRows = (members.data ?? []) as MemberRowInput[];
  const emails = await lookupEmails(emailLookupIds(ctx, memberRows));
  const view = buildWorkspaceView(ctx, memberRows, (invites?.data ?? []) as InviteRowInput[], emails);
  return <WorkspaceClient view={view} />;
}
