// Shared layout for the app pages. Reads the request context on the server; the proxy handles sign-in redirects.
// Sidebar from md width up, a top bar at phone width (ShellHeader handles both), as Shell.dc.html.
import { getRequestContext, type RequestContext } from "@/lib/auth/context";
import { readMostly } from "@/lib/cache/readMostly";
import { getStore } from "@/lib/store";
import type { SessionSummary } from "@/lib/store/types";
import { readLocalOnboarding } from "@/lib/onboarding/file";
import { finishSetupVisible, onboardingEnabled } from "@/lib/onboarding/state";
import ShellHeader, { type ShellUser } from "./ShellHeader";
import { type AgentNames, groupRecent, RECENT_LIMIT, type RecentSessions } from "./recent";

/** 'Finish setup' visibility: local mode reads the file flag, Supabase the user_metadata state (absent = completed). */
async function onboardingOpen(ctx: RequestContext): Promise<boolean> {
  if (!onboardingEnabled()) return false;
  if (ctx.mode === "local") return finishSetupVisible(await readLocalOnboarding());
  return ctx.onboarding ? finishSetupVisible(ctx.onboarding) : false;
}

const toShellUser = (ctx: RequestContext, open = false): ShellUser => ({
  mode: ctx.mode,
  workspaceName: ctx.workspaceName,
  email: ctx.email,
  fullName: ctx.fullName ?? null,
  role: ctx.role,
  workspaceId: ctx.workspaceId,
  memberships: ctx.memberships,
  onboardingOpen: open,
});

export async function shellUser(): Promise<ShellUser | null> {
  const result = await getRequestContext();
  return result.kind === "ok" ? toShellUser(result.ctx, await onboardingOpen(result.ctx)) : null;
}

const agentNames = async (store: ReturnType<typeof getStore>): Promise<AgentNames> =>
  Object.fromEntries((await store.listAgents()).map((a) => [a.id, a.name]));

/**
 * Latest capture and teach sessions of the request-context workspace; a store error never breaks the page.
 * Supabase mode caches the rows for a few seconds per user and workspace (session writes expire the sessions tag).
 */
export async function recentSessions(ctx: RequestContext, now = new Date()): Promise<RecentSessions> {
  try {
    const { supabase } = ctx;
    const store = supabase ? getStore({ supabase, workspaceId: ctx.workspaceId, userId: ctx.userId }) : getStore();
    // Agent names only label the titles: a failed read leaves them out instead of failing the list.
    const names = (supabase ? readMostly("shell-agent-names", ctx, ["agents"], () => agentNames(store)) : agentNames(store)).catch((): AgentNames => ({}));
    const rows = supabase
      ? await readMostly("recent-sessions", ctx, ["sessions"], () => store.recentSessions(RECENT_LIMIT))
      : await store.recentSessions(RECENT_LIMIT);
    // Delete on an empty run: its creator or an owner, as DELETE /api/session/<id> checks.
    const canDelete = (s: SessionSummary) => ctx.role === "owner" || (!!s.created_by && s.created_by === ctx.userId);
    return { kind: "ok", groups: groupRecent(rows, now, await names, RECENT_LIMIT, canDelete) };
  } catch {
    return { kind: "error" };
  }
}

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const result = await getRequestContext();
  const user = result.kind === "ok" ? toShellUser(result.ctx, await onboardingOpen(result.ctx)) : null;
  const recent: RecentSessions = result.kind === "ok" ? await recentSessions(result.ctx) : { kind: "ok", groups: [] };
  return (
    <div className="flex min-h-screen flex-col md:flex-row" style={{ background: "var(--bg)", color: "var(--tx)" }}>
      <ShellHeader user={user} recent={recent} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
