// Expert picker options for /agents/new, read server-side from the request context.
import { expertOption, type ExpertOption } from "@/components/agents/model";
import {
  buildWorkspaceView,
  emailLookupIds,
  MEMBER_DISPLAY_LIMIT,
  type MemberRowInput,
  type RequestContext,
} from "@/lib/auth/context";
import { lookupEmails } from "../../workspace/emails";

const LOCAL_USER: ExpertOption = { userId: "local", name: "Local user", label: "local", initial: "L" };

/**
 * Supabase: the workspace members (same RLS query and labels as /workspace: addresses for owners and the user's own,
 * else the short id), learners left out. Local: the local user. A failed query offers nobody; free typing still works.
 */
export async function loadExpertOptions(ctx: RequestContext): Promise<ExpertOption[]> {
  if (ctx.mode === "local" || !ctx.supabase) return [LOCAL_USER];
  const { data, error } = await ctx.supabase
    .from("workspace_members")
    .select("user_id, role")
    .eq("workspace_id", ctx.workspaceId)
    .order("created_at", { ascending: true })
    .order("user_id", { ascending: true })
    .limit(MEMBER_DISPLAY_LIMIT);
  if (error) {
    console.error("new agent experts:", error.message);
    return [];
  }
  const rows = (data ?? []) as MemberRowInput[];
  const emails = await lookupEmails(emailLookupIds(ctx, rows));
  return buildWorkspaceView(ctx, rows, [], emails)
    .members.filter((m) => m.role !== "learner")
    .map(expertOption);
}
