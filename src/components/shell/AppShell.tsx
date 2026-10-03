// Shared layout for the app pages. Reads the request context on the server; the proxy handles sign-in redirects.
// Sidebar from md width up, a top bar at phone width (ShellHeader handles both), as Shell.dc.html.
import { getRequestContext, type RequestContext } from "@/lib/auth/context";
import { getStore } from "@/lib/store";
import ShellHeader, { type ShellUser } from "./ShellHeader";
import { groupRecent, RECENT_LIMIT, type RecentSessions } from "./recent";

const toShellUser = (ctx: RequestContext): ShellUser => ({
  mode: ctx.mode,
  workspaceName: ctx.workspaceName,
  email: ctx.email,
  role: ctx.role,
  workspaceId: ctx.workspaceId,
  memberships: ctx.memberships,
});

export async function shellUser(): Promise<ShellUser | null> {
  const result = await getRequestContext();
  return result.kind === "ok" ? toShellUser(result.ctx) : null;
}

/** Latest capture and teach sessions of the request-context workspace; a store error never breaks the page. */
export async function recentSessions(ctx: RequestContext, now = new Date()): Promise<RecentSessions> {
  try {
    const store = ctx.supabase ? getStore({ supabase: ctx.supabase, workspaceId: ctx.workspaceId, userId: ctx.userId }) : getStore();
    return { kind: "ok", groups: groupRecent(await store.recentSessions(RECENT_LIMIT), now) };
  } catch {
    return { kind: "error" };
  }
}

export default async function AppShell({ children }: { children: React.ReactNode }) {
  const result = await getRequestContext();
  const user = result.kind === "ok" ? toShellUser(result.ctx) : null;
  const recent: RecentSessions = result.kind === "ok" ? await recentSessions(result.ctx) : { kind: "ok", groups: [] };
  return (
    <div className="flex min-h-screen flex-col md:flex-row" style={{ background: "var(--bg)", color: "var(--tx)" }}>
      <ShellHeader user={user} recent={recent} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
