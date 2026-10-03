"use client";
// Agent settings: rename and change role (owner or expert), open the studio, delete (owner only, with confirmation).
// Deleting keeps the agent's sessions; they become agentless.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Role } from "@/lib/auth/context";
import { AGENT_NAME_MAX, AGENT_ROLE_MAX, type Agent } from "@/lib/types";

export const canEditAgent = (role: Role | null) => role === "owner" || role === "expert";
export const canDeleteAgent = (role: Role | null) => role === "owner";
export const DELETE_CONFIRM = "Delete this agent? Its captures and teach sessions are kept, without the agent.";

export default function AgentSettings({ agent, role }: { agent: Agent; role: Role | null }) {
  const router = useRouter();
  const [name, setName] = useState(agent.name);
  const [agentRole, setAgentRole] = useState(agent.role);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const url = `/api/agents/${encodeURIComponent(agent.id)}`;

  if (!canEditAgent(role)) return <p className="text-sm text-muted">Only owners and experts change agents.</p>;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch(url, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: name.trim(), role: agentRole.trim() }),
      });
      setNotice(res.ok ? "Saved." : `Could not save (${res.status}).`);
      if (res.ok) router.refresh();
    } catch {
      setNotice("Could not save. Check the connection.");
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(DELETE_CONFIRM)) return;
    setBusy(true);
    try {
      const res = await fetch(url, { method: "DELETE" });
      if (res.ok) router.push("/agents");
      else setNotice(`Could not delete (${res.status}).`);
    } catch {
      setNotice("Could not delete. Check the connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 text-sm">
      <form onSubmit={save} className="flex max-w-md flex-col gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-muted">Name</span>
          <input
            className="rounded-lg border border-line bg-panel-2 px-3 py-2"
            value={name}
            maxLength={AGENT_NAME_MAX}
            required
            onChange={(e) => setName(e.target.value)}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-muted">Role</span>
          <input
            className="rounded-lg border border-line bg-panel-2 px-3 py-2"
            value={agentRole}
            maxLength={AGENT_ROLE_MAX}
            required
            onChange={(e) => setAgentRole(e.target.value)}
          />
        </label>
        <button type="submit" disabled={busy} className="self-start rounded-lg bg-accent px-3 py-1.5 text-accent-fg disabled:opacity-50">
          Save
        </button>
      </form>
      <Link className="self-start underline" href={`/agents/${encodeURIComponent(agent.id)}/studio`}>
        Open avatar studio
      </Link>
      {canDeleteAgent(role) && (
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove()}
          className="self-start rounded-lg border border-red-500/60 px-3 py-1.5 text-red-500 hover:bg-red-500/10 disabled:opacity-50"
        >
          Delete agent
        </button>
      )}
      {notice && <p role="status" className="text-muted">{notice}</p>}
    </div>
  );
}
