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
import { captureHref, expertInitials, pickExpert, type ExpertOption, type ExpertPick } from "./model";

export { expertInitials, memberName, type ExpertOption, type ExpertPick } from "./model";

const STEP_LABELS = ["Details", "Avatar", "Install and train"] as const;
const muted = { color: "var(--mu)" } as const;

function Stepper({ active }: { active: 1 | 2 | 3 }) {
  return (
    <ol className="flex flex-wrap items-center gap-3" aria-label="Steps">
      {STEP_LABELS.map((label, i) => {
        const n = i + 1;
        const state = n === active ? "on" : n < active ? "done" : "todo";
        return (
          <li key={label} className="contents">
            {i > 0 && <span aria-hidden="true" className="h-px w-12" style={{ background: "var(--ln2)" }} />}
            <span
              className="flex items-center gap-2.5 text-sm"
              data-state={state}
              aria-current={state === "on" ? "step" : undefined}
              style={{ color: state === "todo" ? "var(--mu)" : "var(--tx)" }}
            >
              <span
                className="ui-mono inline-flex size-7 items-center justify-center rounded-full border text-[13px]"
                style={
                  state === "on"
                    ? { background: "var(--pb)", color: "var(--pf)", borderColor: "var(--pb)" }
                    : state === "done"
                      ? { background: "var(--grs)", color: "var(--gr)", borderColor: "transparent" }
                      : { borderColor: "var(--ln2)" }
                }
              >
                {n}
              </span>
              {label}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export default function NewAgentFlow({
  initialAgentId = null,
  initialName = "",
  initialFirstTask = "",
  initialExpert = { name: "" },
  initialRole = "",
  experts = [],
  embedded,
}: {
  initialAgentId?: string | null;
  initialName?: string;
  initialFirstTask?: string;
  initialExpert?: ExpertPick;
  initialRole?: string;
  experts?: ExpertOption[];
  /**
   * Onboarding (T-0211): hides the stepper, the Cancel link and step 3 (onboarding has its own stepper and walkthrough),
   * and reports the new agent through onCreated. Pass initialAgentId on resume so no second agent is created.
   */
  embedded?: { onCreated: (agentId: string, firstTask: string) => void };
} = {}) {
  const [name, setName] = useState(initialName);
  const [role, setRole] = useState(initialRole);
  const [expert, setExpert] = useState<ExpertPick>(initialExpert);
  // The first task stays client-side: it becomes the ?task title of the Capture link.
  const [firstTask, setFirstTask] = useState(initialFirstTask);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [agentId, setAgentId] = useState<string | null>(initialAgentId);

  // A picked member is held as name plus user id; a typed name is kept as typed. The agent stores the name.
  const expertName = expert.name.trim();
  const picked = expert.userId ? experts.find((o) => o.userId === expert.userId) : undefined;

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
          ...(expertName ? { expert_name: expertName } : {}),
          avatar: DEFAULT_AVATAR,
        }),
      });
      if (!res.ok) {
        setNotice(res.status === 403 ? "Only owners and experts create agents." : `Could not create the agent (${res.status}).`);
        return;
      }
      const id = ((await res.json()) as { id: string }).id;
      setAgentId(id);
      embedded?.onCreated(id, firstTask.trim());
    } catch {
      setNotice("Could not create the agent. Check the connection.");
    } finally {
      setBusy(false);
    }
  }

  if (agentId)
    return (
      <div className="flex flex-col gap-7" data-screen={embedded ? "new-agent-2" : "new-agent-2-3"}>
        {!embedded && <Stepper active={2} />}
        <section className="ui-card flex flex-col gap-4 p-7" data-step="2">
          <div className="flex flex-col gap-1">
            <h2 className="ui-t2">Give {name.trim() || "your agent"} a face</h2>
            <p style={muted}>Learners see this avatar next to their cursor, so pick something friendly and easy to spot.</p>
          </div>
          <AgentAvatarStudio agentId={agentId} />
        </section>
        {!embedded && <section className="ui-card flex flex-col gap-5 p-7" data-step="3">
          <div className="flex flex-col gap-1">
            <h2 className="ui-t2">Install and train</h2>
            <p style={muted}>The expert does one real task. The agent watches quietly and asks at natural pauses.</p>
          </div>
          <div className="flex items-center gap-3 rounded-[12px] p-4" style={{ background: "var(--s2)" }}>
            <Badge kind="confirmed">Running in AI Apprentice</Badge>
            <span className="text-sm" style={muted}>Capture starts directly from the app. Nothing to pair.</span>
          </div>
          <div className="flex flex-wrap justify-end gap-3">
            <Link className={buttonClass("primary")} href={captureHref(agentId, firstTask)}>
              Start training
            </Link>
          </div>
        </section>}
      </div>
    );

  return (
    <div className="flex flex-col gap-7" data-screen="new-agent-1">
      {!embedded && <Stepper active={1} />}
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
            <div className="relative">
              <span
                aria-hidden="true"
                data-testid="expert-chip"
                className="absolute top-2 left-2.5 inline-flex size-7 items-center justify-center rounded-full text-[11px] font-semibold"
                style={{ background: "var(--s3)", color: "var(--tx)" }}
              >
                {picked?.initial ?? expertInitials(expertName || "?")}
              </span>
              <input
                id="na-expert"
                className="ui-inp"
                style={{ paddingLeft: 48 }}
                list="na-experts"
                value={expert.name}
                data-expert-user-id={expert.userId}
                maxLength={AGENT_EXPERT_NAME_MAX}
                placeholder="Pick a workspace member or type a name"
                onChange={(e) => setExpert(pickExpert(e.target.value, experts))}
              />
              <datalist id="na-experts">
                {experts.map((o) => (
                  <option key={o.userId} value={o.name} label={o.label} />
                ))}
              </datalist>
            </div>
            <p className="mt-1.5 text-xs" style={{ color: "var(--fa)" }}>Only the expert can train this agent. They confirm every step before anyone learns from it.</p>
          </div>
          <div>
            <label className="ui-lbl" htmlFor="na-first">First task to learn</label>
            <textarea id="na-first" className="ui-inp" style={{ height: "auto", paddingTop: 10, paddingBottom: 10 }} rows={3} value={firstTask} maxLength={200} placeholder="Coding incoming supplier invoices" onChange={(e) => setFirstTask(e.target.value)} />
          </div>
          <div className="flex flex-wrap justify-between gap-3 pt-1">
            {embedded ? <span /> : <Link className={buttonClass("ghost")} href="/agents">Cancel</Link>}
            <button type="submit" disabled={busy || !name.trim() || !role.trim()} aria-busy={busy} className={buttonClass("primary")}>
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
                learns from <span style={{ color: "var(--tx)" }}>{expertName || "the expert"}</span>
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
