"use client";

// User card (Sidebar.dc.html bottom): avatar initials, the display name and a chevron. No status line and no dot
// (decided 2026-10-04, there is no companion any more). The chevron opens the user menu: Account (address, display
// name edited inline and saved to user_metadata.full_name), Theme (dark / light / system), Sign out.
import Link from "next/link";
import { useId, useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";
import { DISPLAY_NAME_MAX, displayName, nameInitials, saveDisplayName } from "./menuActions";
import ThemeToggle from "./ThemeToggle";
import { useMenu } from "./useMenu";

export type UserCardUser = {
  mode: "local" | "supabase";
  email: string | null;
  fullName?: string | null;
  role: string | null;
  workspaceName: string | null;
  onboardingOpen?: boolean;
};

const chevrons = (
  <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: 16, height: 16, color: "var(--fa)" }} aria-hidden="true">
    <path d="m8 9 4-4 4 4M8 15l4 4 4-4" />
  </svg>
);

export const cardName = (user: UserCardUser | null) =>
  !user ? "Signed out" : user.mode === "local" ? "Local user" : displayName(user.fullName, user.email, "User");

function NameEditor({ initial, onSaved, onCancel }: { initial: string; onSaved: (name: string) => void; onCancel: () => void }) {
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const result = await saveDisplayName(value, createSupabaseBrowserClient().auth).catch(() => ({ ok: false as const, error: "Could not save the name." }));
    setBusy(false);
    if (result.ok) onSaved(result.name);
    else setError(result.error);
  };
  return (
    <form className="flex flex-col gap-[6px]" style={{ padding: "4px 10px 8px" }} onSubmit={(e) => void submit(e)} noValidate>
      <label className="text-xs" style={{ color: "var(--mu)" }}>
        Display name
        <input
          className="ui-inp mt-[4px] w-full"
          name="full_name"
          autoFocus
          maxLength={DISPLAY_NAME_MAX}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.stopPropagation();
              onCancel();
            }
          }}
        />
      </label>
      {error && (
        <span role="alert" className="text-xs" style={{ color: "var(--rd)" }}>
          {error}
        </span>
      )}
      <span className="flex justify-end gap-[6px]">
        <button type="button" className="ui-btn ui-bg ui-bsm" onClick={onCancel}>
          Cancel
        </button>
        <button type="submit" className="ui-btn ui-bp ui-bsm" disabled={busy}>
          Save
        </button>
      </span>
    </form>
  );
}

export default function UserCard({ user }: { user: UserCardUser | null }) {
  const [name, setName] = useState(() => cardName(user));
  const [editing, setEditing] = useState(false);
  const { open, setOpen, rootRef, buttonRef, menuRef, onMenuKeyDown } = useMenu();
  const menuId = useId();
  return (
    <div className="relative md:w-full" ref={rootRef}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="Open user menu"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen(!open)}
        className="flex cursor-pointer items-center gap-[10px] text-left md:w-full"
        style={{ height: 52, padding: "0 10px", borderRadius: 999, border: "1px solid var(--ln)", background: "var(--s1)", color: "var(--tx)" }}
      >
        <span className="ui-av">{nameInitials(name)}</span>
        <span className="hidden min-w-0 flex-1 truncate text-[13px] leading-[1.2] md:block md:group-data-[collapsed=true]:hidden" style={{ fontWeight: 600 }} data-testid="user-name">
          {name}
        </span>
        <span className="hidden md:inline-flex md:group-data-[collapsed=true]:hidden">{chevrons}</span>
      </button>
      <div
        ref={menuRef}
        id={menuId}
        role="menu"
        aria-label="User menu"
        hidden={!open}
        onKeyDown={onMenuKeyDown}
        className="ui-card absolute top-[calc(100%+8px)] right-0 z-20 md:top-auto md:right-auto md:bottom-0 md:left-[calc(100%+14px)]"
        style={{ width: 280, padding: 8, boxShadow: "var(--sh)", background: "var(--s1)", borderColor: "var(--ln2)" }}
      >
        <div className="text-xs" style={{ color: "var(--fa)", padding: "6px 10px 4px" }}>Account</div>
        <div className="flex flex-col" style={{ padding: "2px 10px 8px" }}>
          <span className="text-[13px]" style={{ fontWeight: 600 }}>
            {name}
          </span>
          {user?.email && <span className="text-xs break-all" style={{ color: "var(--mu)" }}>{user.email}</span>}
          {user?.mode === "local" && <span className="text-xs" style={{ color: "var(--mu)" }}>local mode</span>}
          {user?.workspaceName && user.role && (
            <span className="text-xs" style={{ color: "var(--mu)" }}>
              {user.role} in {user.workspaceName}
            </span>
          )}
        </div>
        {user?.mode === "supabase" &&
          (editing ? (
            <NameEditor
              initial={name}
              onCancel={() => setEditing(false)}
              onSaved={(n) => {
                setName(n);
                setEditing(false);
              }}
            />
          ) : (
            <button type="button" role="menuitem" className="ui-mi" onClick={() => setEditing(true)} data-testid="edit-name">
              <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M4 20h4L19 9l-4-4L4 16zM14 6l4 4" />
              </svg>
              Change display name
            </button>
          ))}
        {user && (
          <Link href="/workspace" role="menuitem" className="ui-mi" data-testid="menu-account">
            <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
              <circle cx="12" cy="8" r="4" />
              <path d="M4 20c0-3.5 3.6-6 8-6s8 2.5 8 6" />
            </svg>
            Account and workspace
          </Link>
        )}
        {user?.onboardingOpen && (
          <Link href="/onboarding" role="menuitem" className="ui-mi" data-testid="menu-finish-setup">
            <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
              <path d="M5 12l4 4L19 6" />
            </svg>
            Finish setup
          </Link>
        )}
        <div style={{ height: 1, background: "var(--ln)", margin: "6px 4px" }} />
        <ThemeToggle />
        {user?.mode === "supabase" && (
          <>
            <div style={{ height: 1, background: "var(--ln)", margin: "6px 4px" }} />
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
    </div>
  );
}
