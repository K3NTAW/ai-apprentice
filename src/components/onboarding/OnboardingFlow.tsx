"use client";
// Onboarding (T-0211), look of the canvas NewAgent screens: stepper, cards, primary and ghost buttons.
// Every step can be skipped ('Skip for now'); each mark is saved right away (POST /api/auth/onboarding), so leaving the
// page keeps the progress and completes nothing. A failed save shows an error and still moves on.
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import NewAgentFlow, { type ExpertOption } from "@/components/agents/NewAgentFlow";
import { createWorkspace, renameWorkspace } from "@/components/shell/menuActions";
import { buttonClass } from "@/components/ui";
import type { Role } from "@/lib/auth/context";
import { saveStep, startFirstTraining } from "@/lib/onboarding/client";
import { ONBOARDING_STEPS, resumeStep, STEP_LABELS, type OnboardingState, type OnboardingStep, type StepMark } from "@/lib/onboarding/state";
import { WORKSPACE_CITY_MAX, WORKSPACE_NAME_MAX, workspaceLabel } from "@/lib/workspace/create";
import PermissionsStep from "./PermissionsStep";
import Walkthrough from "./Walkthrough";

const muted = { color: "var(--mu)" } as const;

function Stepper({ active, state }: { active: OnboardingStep; state: OnboardingState }) {
  return (
    <ol className="flex flex-wrap items-center gap-3" aria-label="Steps">
      {ONBOARDING_STEPS.map((step, i) => {
        const mark = state.steps[step];
        const s = step === active ? "on" : mark === "done" ? "done" : mark === "skipped" ? "skipped" : "todo";
        return (
          <li key={step} className="contents">
            {i > 0 && <span aria-hidden="true" className="h-px w-10" style={{ background: "var(--ln2)" }} />}
            <span className="flex items-center gap-2.5 text-sm" data-state={s} aria-current={s === "on" ? "step" : undefined} style={{ color: s === "todo" || s === "skipped" ? "var(--mu)" : "var(--tx)" }}>
              <span
                className="ui-mono inline-flex size-7 items-center justify-center rounded-full border text-[13px]"
                style={
                  s === "on"
                    ? { background: "var(--pb)", color: "var(--pf)", borderColor: "var(--pb)" }
                    : s === "done"
                      ? { background: "var(--grs)", color: "var(--gr)", borderColor: "transparent" }
                      : { borderColor: "var(--ln2)" }
                }
              >
                {i + 1}
              </span>
              {STEP_LABELS[step]}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export type OnboardingWorkspace = { name: string; city: string | null; role: Role };

function WorkspaceStep({ workspace, joined, mode }: { workspace: OnboardingWorkspace; joined: { name: string; role: Role } | null; mode: "local" | "supabase" }) {
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [city, setCity] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [shown, setShown] = useState({ name: workspace.name, city: workspace.city });
  const [rename, setRename] = useState({ name: workspace.name, city: workspace.city ?? "" });
  const canRename = mode === "supabase" && !joined && workspace.role === "owner";
  const saveRename = async (e: FormEvent) => {
    e.preventDefault();
    const r = await renameWorkspace(rename, { fetch: (u, i) => window.fetch(u, i) });
    if (!r.ok) return setMsg(r.error);
    setMsg(null);
    setShown({ name: rename.name.trim(), city: rename.city.trim() || null });
    setEditing(false);
  };
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const r = await createWorkspace({ name, city }, { fetch: (u, i) => window.fetch(u, i), reload: () => window.location.reload() });
    setMsg(r.ok ? null : r.error);
  };
  return (
    <div className="flex flex-col gap-4" data-testid="workspace-step">
      {joined ? (
        <p data-testid="joined">
          You joined <strong>{joined.name}</strong> as {joined.role}
        </p>
      ) : (
        <div className="flex items-center gap-3 rounded-[12px] p-4" style={{ background: "var(--s2)" }}>
          <span className="ui-av">{(shown.name || "W").slice(0, 1).toUpperCase()}</span>
          <span className="flex flex-col">
            <span style={{ fontWeight: 600 }} data-testid="workspace-name">{workspaceLabel(shown.name, shown.city)}</span>
            <span className="text-xs" style={muted}>Your workspace, you are its {workspace.role}</span>
          </span>
          {canRename && !editing && (
            <button type="button" className={`${buttonClass("ghost", "sm")} ml-auto`} onClick={() => setEditing(true)} data-testid="rename-open">
              Edit
            </button>
          )}
        </div>
      )}
      {canRename && editing && (
        <form className="flex flex-col gap-3" onSubmit={(e) => void saveRename(e)} noValidate data-testid="rename-workspace">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            <div>
              <label className="ui-lbl" htmlFor="ob-ws-rename">Workspace name</label>
              <input id="ob-ws-rename" className="ui-inp" required maxLength={WORKSPACE_NAME_MAX} value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} />
            </div>
            <div>
              <label className="ui-lbl" htmlFor="ob-ws-rename-city">City (optional)</label>
              <input id="ob-ws-rename-city" className="ui-inp" maxLength={WORKSPACE_CITY_MAX} value={rename.city} onChange={(e) => setRename({ ...rename, city: e.target.value })} />
            </div>
          </div>
          {msg && <p role="alert" className="text-sm" style={{ color: "var(--rd)" }}>{msg}</p>}
          <div className="flex gap-3">
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setEditing(false)}>Cancel</button>
            <button type="submit" className={buttonClass("secondary", "sm")}>Save</button>
          </div>
        </form>
      )}
      {mode === "local" ? (
        <p className="text-xs" style={muted}>Local mode has one file-backed workspace.</p>
      ) : creating ? (
        <form className="flex flex-col gap-3" onSubmit={(e) => void submit(e)} noValidate data-testid="create-workspace">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
            <div>
              <label className="ui-lbl" htmlFor="ob-ws-name">Workspace name</label>
              <input id="ob-ws-name" className="ui-inp" required maxLength={WORKSPACE_NAME_MAX} value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="ui-lbl" htmlFor="ob-ws-city">City (optional)</label>
              <input id="ob-ws-city" className="ui-inp" maxLength={WORKSPACE_CITY_MAX} value={city} onChange={(e) => setCity(e.target.value)} />
            </div>
          </div>
          {msg && <p role="alert" className="text-sm" style={{ color: "var(--rd)" }}>{msg}</p>}
          <div className="flex gap-3">
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setCreating(false)}>Cancel</button>
            <button type="submit" className={buttonClass("secondary", "sm")}>Create workspace</button>
          </div>
        </form>
      ) : (
        <div>
          <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setCreating(true)}>
            Create another workspace
          </button>
        </div>
      )}
    </div>
  );
}

const INTRO: Record<OnboardingStep, string> = {
  workspace: "This is where your agents and their training live.",
  permissions: "The desktop app needs a few macOS permissions to watch and listen while you train.",
  agent: "Name the agent, say which role it fills and who it learns from.",
  training: "Five short cards on what a training session looks like.",
};

export default function OnboardingFlow({
  initial,
  mode,
  workspace,
  joined,
  canCreateAgents,
  experts,
  next,
  startStep,
}: {
  initial: OnboardingState;
  mode: "local" | "supabase";
  workspace: OnboardingWorkspace;
  joined: { name: string; role: Role } | null;
  canCreateAgents: boolean;
  experts: ExpertOption[];
  next: string;
  startStep?: OnboardingStep;
}) {
  const router = useRouter();
  const [state, setState] = useState(initial);
  const [step, setStep] = useState<OnboardingStep>(startStep ?? resumeStep(initial));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const mark = async (s: OnboardingStep, m: StepMark, agentId?: string) => {
    setBusy(true);
    const r = await saveStep(s, m, { agentId });
    setBusy(false);
    if (r.ok) {
      setState(r.state);
      setError(null);
    } else {
      setState((prev) => ({ ...prev, steps: { ...prev.steps, [s]: prev.steps[s] === "done" ? "done" : m }, agentId: agentId ?? prev.agentId }));
      setError(r.error);
    }
  };
  const advance = async (m: StepMark) => {
    await mark(step, m);
    const i = ONBOARDING_STEPS.indexOf(step);
    if (i < ONBOARDING_STEPS.length - 1) setStep(ONBOARDING_STEPS[i + 1]);
  };
  const start = async () => {
    setBusy(true);
    const { href, save } = await startFirstTraining(state.agentId);
    if (!save.ok) setError(save.error);
    router.push(href);
  };
  const later = async () => {
    await mark("training", "skipped");
    router.push(next);
  };

  return (
    <main className="mx-auto flex w-full max-w-[880px] flex-col gap-7 px-4 pt-12 pb-14 sm:px-10" data-screen="onboarding" data-step={step}>
      <div className="flex flex-col gap-1.5">
        <span className="ui-eb">Set up AI Apprentice</span>
        <h1 className="ui-t1">{STEP_LABELS[step]}</h1>
        <p style={muted}>{INTRO[step]}</p>
      </div>
      <Stepper active={step} state={state} />
      {error && <p role="alert" className="text-sm" style={{ color: "var(--rd)" }}>{error}</p>}
      <section className="ui-card flex flex-col gap-5 p-7">
        {step === "workspace" && <WorkspaceStep workspace={workspace} joined={joined} mode={mode} />}
        {step === "permissions" && <PermissionsStep />}
        {step === "agent" &&
          (canCreateAgents ? (
            <NewAgentFlow
              experts={experts}
              initialAgentId={state.agentId}
              embedded={{ onCreated: (id) => void mark("agent", "done", id) }}
            />
          ) : (
            <p style={muted}>Only owners and experts create agents. Skip this step; your workspace owner adds agents for you.</p>
          ))}
        {step === "training" && <Walkthrough busy={busy} onStart={() => void start()} onLater={() => void later()} />}
        {step !== "training" && (
          <div className="flex flex-wrap justify-between gap-3 border-t pt-5" style={{ borderColor: "var(--ln)" }}>
            <button type="button" className={buttonClass("ghost")} onClick={() => void advance("skipped")} disabled={busy} title="Saving">
              Skip for now
            </button>
            <button
              type="button"
              className={buttonClass("primary")}
              onClick={() => void advance("done")}
              disabled={busy || (step === "agent" && canCreateAgents && !state.agentId)}
              title={step === "agent" ? "Create the agent first" : "Saving"}
            >
              Continue
            </button>
          </div>
        )}
      </section>
    </main>
  );
}
