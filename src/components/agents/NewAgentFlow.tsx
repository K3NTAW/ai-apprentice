"use client";
// Create agent: name, role, expert name; then the avatar studio; then 'Start training' opens Capture with ?agent=<id>.
import Link from "next/link";
import { useState } from "react";
import AgentAvatarStudio from "@/components/avatar/AgentAvatarStudio";
import { DEFAULT_AVATAR } from "@/lib/avatar/render";
import { AGENT_EXPERT_NAME_MAX, AGENT_NAME_MAX, AGENT_ROLE_MAX } from "@/lib/types";
import { captureHref } from "./model";

const input = "rounded-lg border border-line bg-panel-2 px-3 py-2";

export default function NewAgentFlow() {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [expert, setExpert] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(null);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setNotice(null);
    try {
      const res = await fetch("/api/agents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          role: role.trim(),
          ...(expert.trim() ? { expert_name: expert.trim() } : {}),
          avatar: DEFAULT_AVATAR,
        }),
      });
      if (!res.ok) {
        setNotice(res.status === 403 ? "Only owners and experts create agents." : `Could not create the agent (${res.status}).`);
        return;
      }
      setAgentId(((await res.json()) as { id: string }).id);
    } catch {
      setNotice("Could not create the agent. Check the connection.");
    } finally {
      setBusy(false);
    }
  }

  if (agentId)
    return (
      <div className="flex flex-col gap-4">
        <p className="text-sm text-muted">Step 2 of 2: give {name.trim()} a face. Save it, then start training.</p>
        <AgentAvatarStudio agentId={agentId} />
        <Link className="self-start rounded-lg bg-accent px-4 py-2 text-sm text-accent-fg" href={captureHref(agentId)}>
          Start training
        </Link>
      </div>
    );

  return (
    <form onSubmit={create} className="flex max-w-md flex-col gap-3 text-sm">
      <p className="text-muted">Step 1 of 2: who is this agent?</p>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Name</span>
        <input className={input} value={name} maxLength={AGENT_NAME_MAX} required placeholder="Senior Sales Person" onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Role</span>
        <input className={input} value={role} maxLength={AGENT_ROLE_MAX} required placeholder="Prepares and sends quotes" onChange={(e) => setRole(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-muted">Learns from (expert name)</span>
        <input className={input} value={expert} maxLength={AGENT_EXPERT_NAME_MAX} placeholder="Sabine" onChange={(e) => setExpert(e.target.value)} />
      </label>
      <button type="submit" disabled={busy || !name.trim() || !role.trim()} className="self-start rounded-lg bg-accent px-4 py-2 text-accent-fg disabled:opacity-50">
        Next: avatar
      </button>
      {notice && <p role="status" className="text-muted">{notice}</p>}
    </form>
  );
}
