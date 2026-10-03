// App shell navigation: product name, nav, active workspace, user and sign-out (supabase) or a local-mode badge.
// Renders as a left sidebar from md width up and as a top bar at phone width.
import Link from "next/link";
import type { Role } from "@/lib/auth/context";

export const NAV_LINKS = [
  { href: "/agents", label: "Agents" },
  { href: "/learn", label: "Learn" },
  { href: "/workspace", label: "Workspace" },
  { href: "/capture#companion", label: "Install companion" },
] as const;

export type ShellUser = {
  mode: "local" | "supabase";
  workspaceName: string | null;
  email: string | null;
  role: Role | null;
};

/** Owners and experts capture; learners only learn. */
export const canCapture = (role: Role | null): boolean => role === "owner" || role === "expert";

export default function ShellHeader({ user }: { user: ShellUser | null }) {
  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line bg-panel px-4 py-3 text-sm md:sticky md:top-0 md:h-screen md:w-56 md:shrink-0 md:flex-col md:flex-nowrap md:items-stretch md:gap-6 md:border-r md:border-b-0 md:py-6">
      <Link href="/" className="font-semibold tracking-tight">
        AI Apprentice
      </Link>
      <nav className="flex flex-wrap gap-4 md:flex-col md:gap-1">
        {NAV_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="rounded-lg text-muted hover:text-fg md:px-3 md:py-2 md:hover:bg-panel-2">
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex flex-wrap items-center gap-3 md:mt-auto md:ml-0 md:flex-col md:items-start">
        {user && canCapture(user.role) && (
          <Link href="/capture" className="rounded-lg bg-accent px-2 py-1 text-xs text-accent-fg">
            Start capture
          </Link>
        )}
        {user?.workspaceName && <span className="text-muted">{user.workspaceName}</span>}
        {user?.mode === "local" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">local mode</span>}
        {user?.mode === "supabase" && (
          <>
            {user.email && <span className="break-all text-muted">{user.email}</span>}
            <form action="/auth/signout" method="post">
              <button type="submit" className="rounded-lg border border-line px-2 py-1 text-xs hover:bg-panel-2">
                Sign out
              </button>
            </form>
          </>
        )}
      </div>
    </header>
  );
}
