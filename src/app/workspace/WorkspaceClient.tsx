"use client";

import DeletionRequests from "@/components/workspace/DeletionRequests";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Badge, buttonClass, Input } from "@/components/ui";
import type { WorkspaceView } from "@/lib/auth/context";
import { renameWorkspace } from "@/components/shell/menuActions";
import { WORKSPACE_CITY_MAX, WORKSPACE_NAME_MAX } from "@/lib/workspace/create";
import { confirmThen, REMOVE_MEMBER_CONFIRM, REVOKE_INVITE_CONFIRM } from "@/lib/confirm";

const ERRORS: Record<string, string> = {
  invalid_input: "Check the input and try again.",
  invite_exists: "There is already a pending invite for this address.",
  last_owner: "A workspace needs at least one owner.",
  not_found: "Already gone. The list was refreshed.",
  forbidden: "You do not have permission for this.",
  unauthorized: "Your session ended. Sign in again.",
};

async function call(path: string, method: string, body: unknown): Promise<string | null> {
  try {
    const res = await fetch(path, {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (res.ok) return null;
    const data = (await res.json().catch(() => ({}))) as { error?: unknown };
    return (typeof data.error === "string" && ERRORS[data.error]) || "Something went wrong. Try again.";
  } catch {
    return "Network error. Try again.";
  }
}

const muted = { color: "var(--mu)" } as const;
const faint = { color: "var(--fa)" } as const;
const memberRow = "grid grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)_88px] items-center gap-4 border-b border-[var(--ln)] px-5";

const initials = (label: string) =>
  label
    .split(/[.@\s]/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join("");

export default function WorkspaceClient({ view }: { view: WorkspaceView }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const activeCity = view.memberships.find((m) => m.workspaceId === view.workspaceId)?.city ?? "";
  const [wsName, setWsName] = useState(view.workspaceName);
  const [wsCity, setWsCity] = useState(activeCity);
  const [inviteRole, setInviteRole] = useState<"expert" | "learner">("learner");

  async function run(path: string, method: string, body: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    const err = await call(path, method, body);
    setBusy(false);
    setError(err);
    router.refresh();
    return err === null;
  }

  async function onInvite(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (await run("/api/workspace/invites", "POST", { email: inviteEmail, role: inviteRole })) setInviteEmail("");
  }

  async function onRename(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await renameWorkspace({ name: wsName, city: wsCity, initialCity: activeCity }, { fetch: (u, i) => window.fetch(u, i) });
    setBusy(false);
    setError(r.ok ? null : r.error);
    if (r.ok) router.refresh();
  }

  // Workspace.dc.html: header, members table on the left, invite and pending cards on the right.
  return (
    <main className="flex flex-col gap-7 px-4 pt-9 pb-14 sm:px-10" data-screen="workspace">
      <header className="flex items-start justify-between gap-4">
        <div className="flex flex-col gap-1.5">
          <span className="ui-eb">Workspace</span>
          <h1 className="ui-t1">{view.workspaceName}</h1>
          <p className="text-sm" style={muted}>
            {view.members.length} members · {view.email ?? "unknown"} ({view.role})
          </p>
        </div>
        <form method="post" action="/auth/signout">
          <button type="submit" className={buttonClass("secondary", "sm")}>
            Sign out
          </button>
        </form>
      </header>

      {view.memberships.length > 1 && (
        <label className="flex items-center gap-2 text-sm">
          <span className="ui-lbl">Workspace</span>
          <select
            value={view.workspaceId}
            disabled={busy} aria-busy={busy}
            onChange={(e) => void run("/api/workspace/active", "POST", { workspaceId: e.target.value })}
            className="rounded-full border border-[var(--ln2)] bg-[var(--s2)] px-3 py-1.5"
          >
            {view.memberships.map((m) => (
              <option key={m.workspaceId} value={m.workspaceId}>
                {m.name} ({m.role})
              </option>
            ))}
          </select>
        </label>
      )}

      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--rd)" }}>
          {error}
        </p>
      )}

      {view.isOwner && (
        <form className="ui-card flex flex-col gap-3 p-5" onSubmit={(e) => void onRename(e)} noValidate data-testid="rename-workspace">
          <h2 className="ui-t3">Workspace settings</h2>
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            <div>
              <label className="ui-lbl" htmlFor="ws-name">Name</label>
              <input id="ws-name" className="ui-inp" required maxLength={WORKSPACE_NAME_MAX} value={wsName} onChange={(e) => setWsName(e.target.value)} />
            </div>
            <div>
              <label className="ui-lbl" htmlFor="ws-city">City (optional)</label>
              <input id="ws-city" className="ui-inp" maxLength={WORKSPACE_CITY_MAX} value={wsCity} onChange={(e) => setWsCity(e.target.value)} />
            </div>
          </div>
          <div>
            <button type="submit" disabled={busy} className={buttonClass("secondary", "sm")}>Save</button>
          </div>
        </form>
      )}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1.75fr)_minmax(0,1fr)]">
        <section className="ui-card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ln)] px-5 py-4">
            <h2 className="ui-t3">Members</h2>
            <span className="text-xs" style={muted}>
              Owners manage members. Experts train agents. Learners learn.
            </span>
          </div>
          <div className={`${memberRow} py-3 text-xs font-medium`} style={muted}>
            <span>Name</span>
            <span>Role</span>
            <span />
          </div>
          <ul className="flex flex-col">
            {view.members.map((m) => (
              <li key={m.userId} className={`${memberRow} py-3 last:border-b-0`}>
                <span className="flex min-w-0 items-center gap-3">
                  <span className="grid size-8 flex-none place-items-center rounded-full text-[11px] font-semibold" style={{ background: "var(--s3)" }}>
                    {initials(m.label)}
                  </span>
                  <span className="truncate text-sm">
                    {m.label}
                    {m.isSelf ? " - you" : ""}
                  </span>
                </span>
                <span className="text-sm capitalize">{m.role}</span>
                {view.isOwner && !m.isSelf ? (
                  <button
                    type="button"
                    disabled={busy} aria-busy={busy}
                    onClick={() => void confirmThen(REMOVE_MEMBER_CONFIRM, () => run("/api/workspace/members", "DELETE", { userId: m.userId }))}
                    className={buttonClass("ghost", "sm")}
                  >
                    Remove
                  </button>
                ) : (
                  <span />
                )}
              </li>
            ))}
          </ul>
          {view.truncated && (
            <p className="px-5 py-3 text-sm" style={muted}>
              Showing the first 50 members only.
            </p>
          )}
        </section>

        {view.isOwner && (
          <div className="flex flex-col gap-5">
            <form onSubmit={onInvite} className="ui-card flex flex-col gap-3 p-[22px]">
              <h2 className="ui-t3">Invite by email</h2>
              <label className="ui-lbl" htmlFor="invite-email">
                Work email
              </label>
              <Input
                id="invite-email"
                type="email"
                required
                maxLength={254}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@example.com"
              />
              <span className="ui-lbl mt-1">Role</span>
              <div className="inline-flex self-start rounded-full border border-[var(--ln)] p-[3px]" style={{ background: "var(--s2)" }} role="radiogroup" aria-label="Role">
                {(["expert", "learner"] as const).map((r) => (
                  <button
                    key={r}
                    type="button"
                    role="radio"
                    aria-checked={inviteRole === r}
                    onClick={() => setInviteRole(r)}
                    className="h-[34px] rounded-full px-4 text-[13px] font-medium capitalize"
                    style={inviteRole === r ? { background: "var(--s3)", color: "var(--tx)" } : muted}
                  >
                    {r}
                  </button>
                ))}
              </div>
              <p className="text-xs" style={muted}>
                No email is sent. Tell the person to sign in at /login with this address; the invite is accepted at their
                next sign-in.
              </p>
              <button type="submit" disabled={busy} aria-busy={busy} className={buttonClass("primary", "md", "self-start")}>
                Invite
              </button>
            </form>

            <section className="ui-card flex flex-col p-[22px]">
              <div className="flex items-center justify-between pb-3">
                <h2 className="ui-t3">Pending invites</h2>
                <Badge kind="pending">{view.invites.length}</Badge>
              </div>
              {view.invites.length === 0 ? (
                <p className="border-t border-[var(--ln)] pt-3 text-sm" style={muted}>
                  No pending invites.
                </p>
              ) : (
                <ul className="flex flex-col">
                  {view.invites.map((i) => (
                    <li key={i.id} className="flex flex-col gap-2.5 border-t border-[var(--ln)] py-4 last:pb-0">
                      <div className="flex flex-col gap-0.5">
                        <span className="text-sm">{i.email}</span>
                        <span className="text-xs" style={faint}>
                          <span className="capitalize">{i.role}</span> · sent {i.createdAt.slice(0, 10)}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={busy} aria-busy={busy}
                        onClick={() => void confirmThen(REVOKE_INVITE_CONFIRM, () => run("/api/workspace/invites", "DELETE", { id: i.id }))}
                        className={buttonClass("ghost", "sm", "self-start")}
                      >
                        Revoke
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        )}
        <DeletionRequests owner={view.role === "owner"} />
      </div>
    </main>
  );
}
