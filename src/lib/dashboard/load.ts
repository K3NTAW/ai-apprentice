// Server only. Loads the control room inputs through the request context, so RLS applies:
// full sessions from the session store, workspace members and who created each session.
import { MEMBER_DISPLAY_LIMIT, shortId, type RequestContext } from "@/lib/auth/context";
import { getStore } from "@/lib/store";
import type { Session } from "@/lib/types";
import type { CreatedBy, DashboardMember } from "./summary";

export type DashboardInput = { sessions: Session[]; members: DashboardMember[]; createdBy: CreatedBy };

export async function loadDashboardInput(ctx: RequestContext): Promise<DashboardInput> {
  const supabase = ctx.mode === "supabase" ? ctx.supabase : null;
  const store = supabase ? getStore({ supabase, workspaceId: ctx.workspaceId, userId: ctx.userId }) : getStore();
  const summaries = await store.listSessions();
  const full = await Promise.all(summaries.map((s) => store.getSession(s.id)));
  const sessions = full.filter((s): s is Session => s !== null);
  if (!supabase) return { sessions, members: [], createdBy: {} };

  const [members, owners] = await Promise.all([
    supabase
      .from("workspace_members")
      .select("user_id, role")
      .eq("workspace_id", ctx.workspaceId)
      .order("created_at", { ascending: true })
      .order("user_id", { ascending: true })
      .limit(MEMBER_DISPLAY_LIMIT),
    supabase.from("sessions").select("id, created_by").eq("workspace_id", ctx.workspaceId).eq("kind", "teach"),
  ]);
  if (members.error) throw new Error(`dashboard members: ${members.error.message}`);
  if (owners.error) throw new Error(`dashboard sessions: ${owners.error.message}`);

  const createdBy: Record<string, string | null> = {};
  for (const r of (owners.data ?? []) as { id: string; created_by: string | null }[]) createdBy[r.id] = r.created_by;
  return {
    sessions,
    members: ((members.data ?? []) as { user_id: string; role: string }[]).map((m) => ({
      userId: m.user_id,
      label: m.user_id === ctx.userId && ctx.email ? ctx.email : shortId(m.user_id),
      role: m.role,
    })),
    createdBy,
  };
}
