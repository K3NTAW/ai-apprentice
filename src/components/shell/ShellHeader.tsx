// App sidebar, 1:1 with docs/design/canvas/Sidebar.dc.html: logo and collapse toggle, search (⌘K palette), nav, recent
// sessions, workspace card with the switcher, user card. From md width up a 248 px left column (72 px collapsed); at phone width a top bar with the logo, the nav row and the user menu
// (recent sessions and the switcher fold away), as the canvas phone artboards show.
import Link from "next/link";
import HoverPrefetchLink from "./HoverPrefetchLink";
import type { ReactNode } from "react";
import type { Membership, Role } from "@/lib/auth/context";
import CommandPalette from "./CommandPalette";
import HideInApp from "./HideInApp";
import NavLink from "./NavLink";
import SidebarFrame from "./SidebarFrame";
import ThemeToggle from "./ThemeToggle";
import ViewerStatus from "./ViewerStatus";
import WorkspaceSwitcher from "./WorkspaceSwitcher";
import type { RecentSessions } from "./recent";

const icon = (d: ReactNode) => (
  <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
    {d}
  </svg>
);

export const NAV_LINKS = [
  {
    href: "/agents",
    label: "Agents",
    icon: icon(
      <>
        <rect x="3" y="4" width="18" height="16" rx="6" />
        <circle cx="9" cy="11" r=".8" />
        <circle cx="15" cy="11" r=".8" />
        <path d="M9.5 15c1.5 1 3.5 1 5 0" />
      </>,
    ),
  },
  {
    href: "/learn",
    label: "Learn",
    icon: icon(
      <>
        <path d="M3 7.5 12 4l9 3.5-9 3.5z" />
        <path d="M7 9.5V15c0 1.5 2.5 3 5 3s5-1.5 5-3V9.5" />
      </>,
    ),
  },
  {
    href: "/workspace",
    label: "Workspace",
    icon: icon(
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5" />
        <path d="M16 5.5a3 3 0 0 1 0 5.5M18 14c2 .6 3 2.2 3 5" />
      </>,
    ),
  },
  // The canvas 'Install companion' item, renamed; it opens the 'Get the desktop app' panel on /capture and is hidden inside the desktop app.
  {
    href: "/capture#companion",
    label: "Get the desktop app",
    browserOnly: true,
    icon: icon(
      <>
        <rect x="3" y="4" width="18" height="12" rx="2" />
        <path d="M2 20h20M12 7v6M9.5 10.5 12 13l2.5-2.5" />
      </>,
    ),
  },
] as const;

export type ShellUser = {
  mode: "local" | "supabase";
  workspaceName: string | null;
  email: string | null;
  role: Role | null;
  workspaceId?: string | null;
  memberships?: Membership[];
};

/** Owners and experts capture; learners only learn. */
export const canCapture = (role: Role | null): boolean => role === "owner" || role === "expert";

const chevrons = (
  <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: 16, height: 16, color: "var(--fa)" }} aria-hidden="true">
    <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
  </svg>
);

function Logo() {
  return (
    <Link href="/" aria-label="AI Apprentice home" className="flex items-center gap-[10px] no-underline" style={{ color: "var(--tx)", fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em" }}>
      <svg width="26" height="26" viewBox="0 0 28 28" aria-hidden="true" style={{ color: "var(--tx)" }}>
        <rect width="28" height="28" rx="9" fill="currentColor" />
        <circle cx="11" cy="14" r="5" style={{ fill: "var(--bg)" }} />
        <circle cx="19.5" cy="17" r="3" style={{ fill: "var(--bg)" }} opacity=".75" />
      </svg>
      <span className="md:group-data-[collapsed=true]:hidden">apprentice</span>
    </Link>
  );
}

function RecentList({ recent }: { recent: RecentSessions }) {
  return (
    <div className="hidden flex-col gap-[2px] pt-[6px] md:flex md:group-data-[collapsed=true]:hidden" aria-label="Recent sessions">
      {recent.kind === "error" ? (
        <span className="text-xs" style={{ color: "var(--fa)", padding: "0 12px 6px" }}>
          Recent sessions are unavailable.
        </span>
      ) : recent.groups.length === 0 ? (
        <span className="text-xs" style={{ color: "var(--fa)", padding: "0 12px 6px" }}>
          No sessions yet.
        </span>
      ) : (
        recent.groups.map((g, gi) => (
          <div key={g.label} className="flex flex-col gap-[2px]">
            <span className="text-xs" style={{ color: "var(--fa)", padding: gi === 0 ? "0 12px 6px" : "10px 12px 6px" }}>
              {g.label}
            </span>
            {g.items.map((s) => (
              <HoverPrefetchLink key={s.id} href={s.href} className="ui-rb">
                <span className="truncate text-[13px]" style={{ fontWeight: s.live ? 500 : undefined }}>
                  {s.title}
                </span>
                <span className="flex items-center gap-[6px] text-xs" style={{ color: "var(--fa)" }}>
                  {s.live && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--rd)" }} />}
                  {s.meta}
                </span>
              </HoverPrefetchLink>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

/** 'sabine.keller@x' -> 'SK', 'sabine@x' -> 'SA'. */
export function userInitials(email: string | null | undefined, fallback = "AA"): string {
  const local = (email ?? "").split("@")[0] ?? "";
  const parts = local.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return (parts[0]?.slice(0, 2) || fallback).toUpperCase();
}

function UserMenu({ user, inApp }: { user: ShellUser | null; inApp?: boolean }) {
  const name = user?.email ?? (user?.mode === "local" ? "Local user" : "Signed out");
  const ini = userInitials(user?.email);
  const status = <ViewerStatus inApp={inApp} />;
  return (
    <details className="relative md:w-full">
      <summary
        aria-label="Open user menu"
        className="flex cursor-pointer list-none items-center gap-[10px] [&::-webkit-details-marker]:hidden md:w-full"
        style={{ height: 52, padding: "0 10px", borderRadius: 999, border: "1px solid var(--ln)", background: "var(--s1)", color: "var(--tx)" }}
      >
        <span className="ui-av">{ini}</span>
        <span className="hidden min-w-0 flex-1 flex-col md:flex md:group-data-[collapsed=true]:hidden">
          <span className="truncate text-[13px] leading-[1.2]" style={{ fontWeight: 600 }}>
            {name}
          </span>
          {status}
        </span>
        <span className="hidden md:inline-flex md:group-data-[collapsed=true]:hidden">{chevrons}</span>
      </summary>
      <div
        role="menu"
        aria-label="User menu"
        className="ui-card absolute top-[calc(100%+8px)] right-0 z-20 md:top-auto md:right-auto md:bottom-0 md:left-[calc(100%+14px)]"
        style={{ width: 260, padding: 8, boxShadow: "var(--sh)", background: "var(--s1)", borderColor: "var(--ln2)" }}
      >
        <div className="flex flex-col" style={{ padding: "8px 10px 10px" }}>
          <span className="text-[13px]" style={{ fontWeight: 600 }}>
            {user?.workspaceName ?? "AI Apprentice"}
          </span>
          {user?.email && <span className="text-xs break-all" style={{ color: "var(--mu)" }}>{user.email}</span>}
          {user?.mode === "local" && <span className="text-xs" style={{ color: "var(--mu)" }}>local mode</span>}
          {user?.role && <span className="text-xs" style={{ color: "var(--mu)" }}>{user.role}</span>}
        </div>
        <div style={{ height: 1, background: "var(--ln)", margin: "0 4px 6px" }} />
        {user && (
          <Link href="/workspace" role="menuitem" className="ui-mi" data-testid="menu-account">
            <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
            </svg>
            Account and workspace
          </Link>
        )}
        <ThemeToggle />
        {user?.mode === "supabase" && (
          <>
            <form action="/auth/signout" method="post">
              <button type="submit" role="menuitem" className="ui-mi" style={{ color: "var(--mu)" }}>
                <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" />
                </svg>
                Sign out
              </button>
            </form>
          </>
        )}
      </div>
    </details>
  );
}

export default function ShellHeader({
  user,
  recent = { kind: "ok", groups: [] },
  inApp,
}: {
  user: ShellUser | null;
  recent?: RecentSessions;
  /** Tests only: forces the desktop-app detection. */
  inApp?: boolean;
}) {
  return (
    <SidebarFrame viewer={user?.email ?? user?.mode ?? "anonymous"} logo={<Logo />}>
      {user && <CommandPalette />}

      <nav aria-label="App" className="order-last flex w-full gap-[2px] overflow-x-auto md:order-none md:flex-col">
        {NAV_LINKS.map((l) => {
          const link = (
            <NavLink key={l.href} href={l.href}>
              {l.icon}
              <span className="md:group-data-[collapsed=true]:hidden">{l.label}</span>
            </NavLink>
          );
          return "browserOnly" in l ? <HideInApp key={l.href}>{link}</HideInApp> : link;
        })}
      </nav>

      {user && canCapture(user.role) && (
        <Link href="/capture" className="ui-btn ui-bp ui-bsm ml-auto md:ml-0 md:group-data-[collapsed=true]:hidden">
          Start capture
        </Link>
      )}

      <RecentList recent={recent} />

      <div className="hidden flex-1 md:block" />

      {user && (
        <div className="hidden md:block md:group-data-[collapsed=true]:hidden" aria-label="Workspace">
          <WorkspaceSwitcher
            mode={user.mode}
            name={user.workspaceName ?? (user.mode === "local" ? "local" : "No workspace")}
            activeId={user.workspaceId ?? null}
            memberships={user.memberships ?? []}
          />
        </div>
      )}
      {user?.mode === "local" && <span className="ui-bdg ui-k-jc md:hidden">local mode</span>}

      <div className={user && canCapture(user.role) ? "" : "ml-auto md:ml-0"}>
        <UserMenu user={user} inApp={inApp} />
      </div>
    </SidebarFrame>
  );
}
