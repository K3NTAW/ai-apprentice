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
import RecentDelete from "./RecentDelete";
import SidebarFrame from "./SidebarFrame";
import UserCard from "./UserCard";
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
  /** user_metadata.full_name; the card falls back to the address local part. */
  fullName?: string | null;
  role: Role | null;
  workspaceId?: string | null;
  memberships?: Membership[];
  /** 'Finish setup' in the user menu (T-0211): onboarding not completed or a step skipped. */
  onboardingOpen?: boolean;
};

/** Owners and experts capture; learners only learn. */
export const canCapture = (role: Role | null): boolean => role === "owner" || role === "expert";

function Logo() {
  return (
    <Link href="/agents" aria-label="AI Apprentice home" className="flex items-center gap-[10px] no-underline" style={{ color: "var(--tx)", fontWeight: 600, fontSize: 15, letterSpacing: "-0.01em" }}>
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
            {g.items.map((s) => {
              const link = (
                <HoverPrefetchLink key={s.id} href={s.href} className={s.deletable ? "ui-rb min-w-0 flex-1" : "ui-rb"}>
                  <span className="truncate text-[13px]" style={{ fontWeight: s.live ? 500 : undefined }}>
                    {s.title}
                  </span>
                  <span className="flex items-center gap-[6px] text-xs" style={{ color: "var(--fa)" }}>
                    {s.live && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--rd)" }} />}
                    {s.meta}
                  </span>
                </HoverPrefetchLink>
              );
              if (!s.deletable) return link;
              return (
                <div key={s.id} className="flex items-center gap-[4px]">
                  {link}
                  <RecentDelete id={s.id} />
                </div>
              );
            })}
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

export default function ShellHeader({
  user,
  recent = { kind: "ok", groups: [] },
  inApp,
}: {
  user: ShellUser | null;
  recent?: RecentSessions;
  /** Tests only: forces the desktop-app detection (the user card no longer shows it). */
  inApp?: boolean;
}) {
  void inApp;
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
        <UserCard user={user} />
      </div>
    </SidebarFrame>
  );
}
