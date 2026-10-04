"use client";

// The sidebar column with the collapse toggle (Sidebar.dc.html). Collapsed: a 72 px icon rail from md width up; labels,
// the search hint and recent sessions hide via group-data-[collapsed=true]. The state is remembered per viewer in
// localStorage; storage errors (private mode, quota) fall back to expanded.
import { useEffect, useState, type ReactNode } from "react";

export const collapseKey = (viewer: string) => `apprentice.sidebar.collapsed:${viewer}`;

export function readCollapsed(viewer: string): boolean {
  try {
    return window.localStorage.getItem(collapseKey(viewer)) === "1";
  } catch {
    return false;
  }
}

export function writeCollapsed(viewer: string, collapsed: boolean): void {
  try {
    window.localStorage.setItem(collapseKey(viewer), collapsed ? "1" : "0");
  } catch {
    // Not remembered; the toggle still works for this page.
  }
}

export function CollapseToggle({ collapsed, onToggle }: { collapsed: boolean; onToggle?: () => void }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      aria-pressed={collapsed}
      className="ui-btn ui-bg ui-bi ui-bsm hidden md:inline-flex"
    >
      <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="3" y="4" width="18" height="16" rx="4" />
        <path d="M9 4v16" />
      </svg>
    </button>
  );
}

export default function SidebarFrame({ viewer, logo, children }: { viewer: string; logo: ReactNode; children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- localStorage only exists on the client.
    setCollapsed(readCollapsed(viewer));
  }, [viewer]);
  const toggle = () => {
    setCollapsed((c) => {
      writeCollapsed(viewer, !c);
      return !c;
    });
  };
  return (
    <header
      data-collapsed={collapsed ? "true" : "false"}
      className={`group flex flex-wrap items-center gap-[14px] px-3 py-3 md:sticky md:top-0 md:h-screen md:shrink-0 md:flex-col md:flex-nowrap md:items-stretch md:overflow-y-auto md:py-4 ${collapsed ? "md:w-[72px]" : "md:w-[248px]"}`}
      style={{ background: "var(--bg)", borderRight: "1px solid var(--ln)", borderBottom: "1px solid var(--ln)" }}
    >
      <div className="flex items-center justify-between gap-2 md:group-data-[collapsed=true]:flex-col" style={{ padding: "2px 4px 2px 8px" }}>
        {logo}
        <CollapseToggle collapsed={collapsed} onToggle={toggle} />
      </div>
      {children}
    </header>
  );
}
