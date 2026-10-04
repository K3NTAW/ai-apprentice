"use client";

// Workspace card and menu (Sidebar.dc.html bottom area, Shell.dc.html 'Workspaces' menu). Supabase mode: the row opens
// a menu with the user's workspaces (role badge, check on the active one; choosing one switches via
// POST /api/workspace/active and reloads), 'Create workspace' (dialog, POST /api/workspace, then into the new one) and
// 'Workspace settings'. Every role may switch and create. Local mode has one workspace: a static row.
import Link from "next/link";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import type { Membership } from "@/lib/auth/context";
import { WORKSPACE_CITY_MAX, WORKSPACE_NAME_MAX, workspaceLabel } from "@/lib/workspace/create";
import { createWorkspace, switchWorkspace, type MenuDeps } from "./menuActions";
import { useMenu } from "./useMenu";

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

const check = (
  <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: 16, height: 16, color: "var(--tx)" }} aria-hidden="true" data-testid="active-check">
    <path d="m5 12.5 4.5 4.5L19 7.5" />
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

const browserDeps = (): MenuDeps => ({
  fetch: (url, init) => window.fetch(url, init),
  reload: () => window.location.reload(),
});

/** The 'Create workspace' dialog: name required (1..60), optional city. */
export function CreateWorkspaceDialog({ onClose, deps }: { onClose: () => void; deps?: MenuDeps }) {
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const titleId = useId();
  useEffect(() => nameRef.current?.focus(), []);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await createWorkspace({ name, city }, deps ?? browserDeps());
    setBusy(false);
    if (!result.ok) setError(result.error);
  };
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center" style={{ background: "color-mix(in srgb, var(--bg) 70%, transparent)" }} onKeyDown={(e) => e.key === "Escape" && onClose()}>
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="ui-card flex flex-col gap-[12px]"
        style={{ width: 380, maxWidth: "calc(100vw - 24px)", padding: 20, boxShadow: "var(--sh)", background: "var(--s1)", borderColor: "var(--ln2)" }}
        onSubmit={(e) => void submit(e)}
        noValidate
      >
        <h2 id={titleId} className="text-[15px]" style={{ fontWeight: 600 }}>
          Create workspace
        </h2>
        <label className="flex flex-col gap-[6px] text-xs" style={{ color: "var(--mu)" }}>
          Name
          <input ref={nameRef} className="ui-inp" name="name" required maxLength={WORKSPACE_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="flex flex-col gap-[6px] text-xs" style={{ color: "var(--mu)" }}>
          City (optional)
          <input className="ui-inp" name="city" maxLength={WORKSPACE_CITY_MAX} value={city} onChange={(e) => setCity(e.target.value)} />
        </label>
        {error && (
          <div role="alert" className="text-xs" style={{ color: "var(--rd)" }}>
            {error}
          </div>
        )}
        <div className="flex justify-end gap-[8px]">
          <button type="button" className="ui-btn ui-bg ui-bsm" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="ui-btn ui-bp ui-bsm" disabled={busy}>
            {busy ? "Creating…" : "Create"}
          </button>
        </div>
      </form>
    </div>
  );
}

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
  const [creating, setCreating] = useState(false);
  const { open, setOpen, close, rootRef, buttonRef, menuRef, onMenuKeyDown } = useMenu();
  const menuId = useId();
  if (mode === "local") {
    return (
      <div className="flex items-center gap-[10px]" style={rowStyle}>
        <Tile name={name} />
        <span className="flex-1 truncate">{name}</span>
        <span className="ui-bdg ui-k-jc">local mode</span>
      </div>
    );
  }
  const active = memberships.find((m) => m.workspaceId === activeId);
  const select = async (workspaceId: string) => {
    setError(false);
    const result = await switchWorkspace(workspaceId, activeId, browserDeps());
    if (!result.ok) setError(true);
    else if (workspaceId === activeId) close();
  };
  return (
    <div className="relative" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Switch workspace"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
        className="flex w-full cursor-pointer items-center gap-[10px] text-left"
        style={rowStyle}
      >
        <Tile name={name} />
        <span className="flex-1 truncate">{workspaceLabel(name, active?.city)}</span>
        {chevrons}
      </button>
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label="Workspaces"
        hidden={!open}
        onKeyDown={onMenuKeyDown}
        className="ui-card absolute bottom-[calc(100%+8px)] left-0 z-20"
        style={{ width: 300, maxWidth: "calc(100vw - 24px)", padding: 8, boxShadow: "var(--sh)", background: "var(--s1)", borderColor: "var(--ln2)" }}
      >
        <div className="text-xs" style={{ color: "var(--fa)", padding: "6px 10px 4px" }}>Workspaces</div>
        {memberships.map((m) => {
          const on = m.workspaceId === activeId;
          return (
            <button
              key={m.workspaceId}
              type="button"
              role="menuitemradio"
              aria-checked={on}
              className={on ? "ui-mi ui-on" : "ui-mi"}
              onClick={() => void select(m.workspaceId)}
            >
              <Tile name={m.name} size={26} />
              <span className="flex-1 truncate">{workspaceLabel(m.name, m.city)}</span>
              <span className="ui-bdg">{m.role}</span>
              <span style={{ width: 16, display: "inline-flex" }}>{on && check}</span>
            </button>
          );
        })}
        {error && <div role="alert" className="text-xs" style={{ color: "var(--rd)", padding: "6px 10px" }}>Could not switch workspace.</div>}
        <div style={{ height: 1, background: "var(--ln)", margin: "6px 4px" }} />
        <button
          type="button"
          role="menuitem"
          className="ui-mi"
          onClick={() => {
            setOpen(false);
            setCreating(true);
          }}
        >
          <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 5v14M5 12h14" />
          </svg>
          Create workspace
        </button>
        <Link href="/workspace" role="menuitem" className="ui-mi" onClick={() => setOpen(false)}>
          <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
            <circle cx="12" cy="12" r="3" />
            <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
          </svg>
          Workspace settings
        </Link>
      </div>
      {creating && <CreateWorkspaceDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
