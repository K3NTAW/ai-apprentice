"use client";
// Create agent: name, role, expert name; then the avatar studio; then 'Start training' opens Capture with ?agent=<id>.
// Look: NewAgent.dc.html (1 Details), NewAgent2.dc.html (2 Avatar), NewAgent3.dc.html (3 Install and train).
// Behaviour unchanged: step 1 creates the agent, then steps 2 and 3 show together. There is no pairing: step 3
// shows the 'Running in AI Apprentice' status instead of the canvas pairing card.
import Link from "next/link";
import { useState } from "react";
import AgentAvatarStudio from "@/components/avatar/AgentAvatarStudio";
import { Badge, buttonClass } from "@/components/ui";
import { DEFAULT_AVATAR } from "@/lib/avatar/render";
import { AGENT_EXPERT_NAME_MAX, AGENT_NAME_MAX, AGENT_ROLE_MAX } from "@/lib/types";
import AgentAvatar from "./AgentAvatar";
import { captureHref } from "./model";

const STEP_LABELS = ["Details", "Avatar", "Install and train"] as const;
const muted = { color: "var(--mu)" } as const;

function Stepper({ active }: { active: 1 | 2 | 3 }) {
  return (
    <ol className="flex flex-wrap items-center gap-3" aria-label="Steps">
      {STEP_LABELS.map((label, i) => (
        <li key={label} className="contents">
          {i > 0 && <span aria-hidden="true" className="h-px w-12" style={{ background: "var(--ln2)" }} />}
          <span
            className="flex items-center gap-2 text-sm"
            aria-current={i + 1 === active ? "step" : undefined}
            style={{ color: i + 1 <= active ? "var(--tx)" : "var(--mu)" }}
          >
            <span
              className="ui-mono inline-flex size-6 items-center justify-center rounded-full border text-xs"
              style={i + 1 === active ? { background: "var(--tx)", color: "var(--bg)", borderColor: "var(--tx)" } : { borderColor: "var(--ln2)" }}
            >
              {i + 1}
            </span>
            {label}
          </span>
        </li>
      ))}
    </ol>
  );
}

export default function NewAgentFlow({ initialAgentId = null }: { initialAgentId?: string | null } = {}) {
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [expert, setExpert] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(initialAgentId);

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
      <div className="flex flex-col gap-7" data-screen="new-agent-2-3">
        <Stepper active={2} />
        <section className="ui-card flex flex-col gap-4 p-7" data-step="2">
          <div className="flex flex-col gap-1">
            <h2 className="ui-t2">Give {name.trim() || "your agent"} a face</h2>
            <p style={muted}>Learners see this avatar next to their cursor, so pick something friendly and easy to spot.</p>
          </div>
          <AgentAvatarStudio agentId={agentId} />
        </section>
        <section className="ui-card flex flex-col gap-5 p-7" data-step="3">
          <div className="flex flex-col gap-1">
            <h2 className="ui-t2">Install and train</h2>
            <p style={muted}>The expert does one real task. The agent watches quietly and asks at natural pauses.</p>
          </div>
          <div className="flex items-center gap-3 rounded-[12px] p-4" style={{ background: "var(--s2)" }}>
            <Badge kind="confirmed">Running in AI Apprentice</Badge>
            <span className="text-sm" style={muted}>Capture starts directly from the app. Nothing to pair.</span>
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <Link className={buttonClass("primary")} href={captureHref(agentId)}>
              Start training
            </Link>
          </div>
        </section>
      </div>
    );

  return (
    <div className="flex flex-col gap-7" data-screen="new-agent-1">
      <Stepper active={1} />
      <div className="flex flex-wrap items-start gap-6">
        <form onSubmit={create} className="ui-card flex min-w-0 flex-[3_1_480px] flex-col gap-5 p-7">
          <div className="flex flex-col gap-1">
            <h2 className="ui-t2">Who is it, and who does it learn from?</h2>
            <p style={muted}>You can change all of this later.</p>
          </div>
          <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(220px,1fr))]">
            <div>
              <label className="ui-lbl" htmlFor="na-name">Agent name</label>
              <input id="na-name" className="ui-inp" value={name} maxLength={AGENT_NAME_MAX} required placeholder="Senior Sales Person" onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="ui-lbl" htmlFor="na-role">Role it will fill</label>
              <input id="na-role" className="ui-inp" value={role} maxLength={AGENT_ROLE_MAX} required placeholder="Prepares and sends quotes" onChange={(e) => setRole(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="ui-lbl" htmlFor="na-expert">Expert it learns from</label>
            <input id="na-expert" className="ui-inp" value={expert} maxLength={AGENT_EXPERT_NAME_MAX} placeholder="Sabine" onChange={(e) => setExpert(e.target.value)} />
            <p className="mt-1.5 text-xs" style={{ color: "var(--fa)" }}>Only the expert can train this agent. They confirm every step before anyone learns from it.</p>
          </div>
          <div className="flex flex-wrap justify-between gap-3 pt-1">
            <Link className={buttonClass("ghost")} href="/agents">Cancel</Link>
            <button type="submit" disabled={busy || !name.trim() || !role.trim()} className={buttonClass("primary")}>
              Continue
            </button>
          </div>
          {notice && <p role="status" style={muted}>{notice}</p>}
        </form>
        <div className="flex min-w-0 flex-[2_1_320px] flex-col gap-3">
          <span className="ui-eb">Card preview</span>
          <div className="ui-card flex flex-col gap-3.5 p-4">
            <div className="flex h-[168px] items-center justify-center rounded-[12px]" style={{ background: "var(--stage)" }}>
              <AgentAvatar avatar={DEFAULT_AVATAR} size={112} />
            </div>
            <div className="flex flex-col gap-0.5 px-1">
              <span className="ui-t2">{name.trim() || "Agent name"}</span>
              <span style={muted}>{role.trim() || "Role it will fill"}</span>
              <span className="text-sm" style={muted}>
                learns from <span style={{ color: "var(--tx)" }}>{expert.trim() || "the expert"}</span>
              </span>
            </div>
            <Badge kind="pending" className="ml-1 self-start">Not trained yet</Badge>
          </div>
          <p className="text-xs" style={{ color: "var(--fa)" }}>Next you give it a face. The default is a grey round shape.</p>
        </div>
      </div>
    </div>
  );
}
