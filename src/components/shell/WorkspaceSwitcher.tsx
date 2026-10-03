"use client";

// Workspace switcher (Sidebar.dc.html button, Shell.dc.html 'Workspaces' menu). Supabase mode lists the memberships and
// switches via POST /api/workspace/active, then reloads; every role may switch. Local mode has one workspace: a static row.
import { useState } from "react";
import type { Membership } from "@/lib/auth/context";

const initials = (name: string) =>
  name
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("") || "W";

const chevrons = (
  <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: 14, height: 14 }} aria-hidden="true">
    <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
  </svg>
);

function Tile({ name, size = 20 }: { name: string; size?: number }) {
  return (
    <span
      style={{ width: size, height: size, borderRadius: size > 20 ? 8 : 6, background: "var(--s3)", color: "var(--tx)", display: "inline-flex", alignItems: "center", justifyContent: "center", fontSize: size > 20 ? 11 : 10, fontWeight: 600, flex: "none" }}
    >
      {initials(name)}
    </span>
  );
}

const rowStyle = { height: 40, padding: "0 12px", borderRadius: 999, color: "var(--mu)", fontSize: 13 } as const;

export default function WorkspaceSwitcher({
  mode,
  name,
  activeId,
  memberships,
}: {
  mode: "local" | "supabase";
  name: string;
  activeId: string | null;
  memberships: Membership[];
}) {
  const [error, setError] = useState(false);
  if (mode === "local" || memberships.length < 2) {
    return (
      <div className="flex items-center gap-[10px]" style={rowStyle}>
        <Tile name={name} />
        <span className="flex-1 truncate">{name}</span>
        {mode === "local" && <span className="ui-bdg ui-k-jc">local mode</span>}
      </div>
    );
  }
  const select = async (workspaceId: string) => {
    if (workspaceId === activeId) return;
    setError(false);
    const res = await fetch("/api/workspace/active", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ workspaceId }),
    }).catch(() => null);
    if (res?.ok) window.location.reload();
    else setError(true);
  };
  return (
    <details className="relative">
      <summary aria-label="Switch workspace" className="flex cursor-pointer list-none items-center gap-[10px] [&::-webkit-details-marker]:hidden" style={rowStyle}>
        <Tile name={name} />
        <span className="flex-1 truncate">{name}</span>
        {chevrons}
      </summary>
      <div
        role="menu"
        aria-label="Workspaces"
        className="ui-card absolute bottom-[calc(100%+8px)] left-0 z-20"
        style={{ width: 300, maxWidth: "calc(100vw - 24px)", padding: 8, boxShadow: "var(--sh)", background: "var(--s1)", borderColor: "var(--ln2)" }}
      >
        <div className="text-xs" style={{ color: "var(--fa)", padding: "6px 10px 4px" }}>Workspaces</div>
        {memberships.map((m) => (
          <button key={m.workspaceId} type="button" role="menuitem" className={m.workspaceId === activeId ? "ui-mi ui-on" : "ui-mi"} onClick={() => void select(m.workspaceId)}>
            <Tile name={m.name} size={26} />
            <span className="flex-1 truncate">{m.name}</span>
            <span className="text-xs" style={{ color: "var(--fa)" }}>{m.role}</span>
          </button>
        ))}
        {error && <div role="alert" className="text-xs" style={{ color: "var(--rd)", padding: "6px 10px" }}>Could not switch workspace.</div>}
      </div>
    </details>
  );
}
