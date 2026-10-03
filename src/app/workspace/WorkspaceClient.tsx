"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import type { WorkspaceView } from "@/lib/auth/context";

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

export default function WorkspaceClient({ view }: { view: WorkspaceView }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
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

  return (
    <main className="flex max-w-2xl flex-col gap-6 p-8">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold">{view.workspaceName}</h1>
          <p className="text-sm">
            {view.email ?? "unknown"} ({view.role})
          </p>
        </div>
        <form method="post" action="/auth/signout">
          <button type="submit" className="rounded border px-3 py-1">
            Sign out
          </button>
        </form>
      </header>

      {view.memberships.length > 1 && (
        <label className="flex items-center gap-2">
          <span>Workspace</span>
          <select
            value={view.workspaceId}
            disabled={busy}
            onChange={(e) => void run("/api/workspace/active", "POST", { workspaceId: e.target.value })}
            className="rounded border px-2 py-1"
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
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">Members</h2>
        <ul className="flex flex-col gap-1">
          {view.members.map((m) => (
            <li key={m.userId} className="flex items-center justify-between gap-4">
              <span>
                {m.label} ({m.role}){m.isSelf ? " - you" : ""}
              </span>
              {view.isOwner && !m.isSelf && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run("/api/workspace/members", "DELETE", { userId: m.userId })}
                  className="rounded border px-2 py-0.5 text-sm"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
        {view.truncated && <p className="text-sm">Showing the first 50 members only.</p>}
      </section>

      {view.isOwner && (
        <section className="flex flex-col gap-2">
          <h2 className="font-semibold">Pending invites</h2>
          {view.invites.length === 0 ? (
            <p className="text-sm">No pending invites.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {view.invites.map((i) => (
                <li key={i.id} className="flex items-center justify-between gap-4">
                  <span>
                    {i.email} ({i.role})
                  </span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void run("/api/workspace/invites", "DELETE", { id: i.id })}
                    className="rounded border px-2 py-0.5 text-sm"
                  >
                    Revoke
                  </button>
                </li>
              ))}
            </ul>
          )}

          <form onSubmit={onInvite} className="flex flex-col gap-2">
            <h3 className="font-semibold">Invite</h3>
            <p className="text-sm">
              No email is sent. Tell the person to sign in at /login with this address; the invite is accepted at their
              next sign-in.
            </p>
            <div className="flex gap-2">
              <input
                type="email"
                required
                maxLength={254}
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                placeholder="name@example.com"
                className="flex-1 rounded border px-2 py-1"
              />
              <select
                value={inviteRole}
                onChange={(e) => setInviteRole(e.target.value as "expert" | "learner")}
                className="rounded border px-2 py-1"
              >
                <option value="learner">learner</option>
                <option value="expert">expert</option>
              </select>
              <button type="submit" disabled={busy} className="rounded border px-3 py-1">
                Invite
              </button>
            </div>
          </form>
        </section>
      )}
    </main>
  );
}
