// Server only. Loads the control room inputs through the request context, so RLS applies:
// session digests (no child rows) from the session store and workspace members, in parallel.
import { MEMBER_DISPLAY_LIMIT, shortId, type RequestContext } from "@/lib/auth/context";
import { getStore } from "@/lib/store";
import type { SessionDigest } from "@/lib/types";
import type { CreatedBy, DashboardMember } from "./summary";

export type DashboardInput = { sessions: SessionDigest[]; members: DashboardMember[]; createdBy: CreatedBy };

export async function loadDashboardInput(ctx: RequestContext): Promise<DashboardInput> {
  const supabase = ctx.mode === "supabase" ? ctx.supabase : null;
  const store = supabase ? getStore({ supabase, workspaceId: ctx.workspaceId, userId: ctx.userId }) : getStore();
  const [sessions, members] = await Promise.all([
    store.listSessionDigests(),
    supabase
      ? supabase
          .from("workspace_members")
          .select("user_id, role")
          .eq("workspace_id", ctx.workspaceId)
          .order("created_at", { ascending: true })
          .order("user_id", { ascending: true })
          .limit(MEMBER_DISPLAY_LIMIT)
      : null,
  ]);
  if (!supabase || !members) return { sessions, members: [], createdBy: {} };
  if (members.error) throw new Error(`dashboard members: ${members.error.message}`);

  // Who created each teach session; the digests carry created_by, so no extra query.
  const createdBy: Record<string, string | null> = {};
  for (const s of sessions) if (s.kind === "teach") createdBy[s.id] = s.created_by ?? null;
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
