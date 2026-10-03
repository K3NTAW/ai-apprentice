// App shell header: product name, nav, active workspace, user and sign-out (supabase) or a local-mode badge.
import Link from "next/link";
import type { Role } from "@/lib/auth/context";

export const NAV_LINKS = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/capture", label: "Capture" },
  { href: "/map", label: "Work Maps" },
  { href: "/teach", label: "Teach" },
  { href: "/workspace", label: "Workspace" },
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
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-slate-200 px-4 py-2 text-sm">
      <Link href="/" className="font-semibold">
        AI Apprentice
      </Link>
      <nav className="flex flex-wrap gap-4">
        {NAV_LINKS.map((l) => (
          <Link key={l.href} href={l.href} className="text-slate-700 hover:underline">
            {l.label}
          </Link>
        ))}
      </nav>
      <div className="ml-auto flex flex-wrap items-center gap-3">
        {user && canCapture(user.role) && (
          <Link href="/capture" className="rounded bg-slate-900 px-2 py-1 text-xs text-white">
            Start capture
          </Link>
        )}
        {user?.workspaceName && <span className="text-slate-500">{user.workspaceName}</span>}
        {user?.mode === "local" && <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">local mode</span>}
        {user?.mode === "supabase" && (
          <>
            {user.email && <span className="text-slate-500">{user.email}</span>}
            <form action="/auth/signout" method="post">
              <button type="submit" className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                Sign out
              </button>
            </form>
          </>
        )}
      </div>
    </header>
  );
}
