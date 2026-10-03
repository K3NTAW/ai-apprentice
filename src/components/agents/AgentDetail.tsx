// Agent page: header with the big avatar, Train and Teach buttons, and tabs selected by ?tab= (server rendered).
import Link from "next/link";
import { canCapture } from "@/components/shell/ShellHeader";
import type { Role } from "@/lib/auth/context";
import type { Agent } from "@/lib/types";
import { guardrailKindLabel } from "@/lib/workmap/view";
import AgentAvatar from "./AgentAvatar";
import { cardClass, Stats } from "./AgentGallery";
import AgentSettings from "./AgentSettings";
import {
  AGENT_TABS,
  agentHref,
  captureHref,
  expertLine,
  learnHref,
  masteryText,
  TAB_LABELS,
  type AgentTab,
  type GuardrailRow,
  type LearnerRow,
  type ProcessRow,
  type ShortcutRow,
} from "./model";
import type { AgentStats } from "@/lib/agents/stats";

export type AgentDetailProps = {
  agent: Agent;
  role: Role | null;
  tab: AgentTab;
  stats: AgentStats;
  processes: ProcessRow[];
  shortcuts: ShortcutRow[];
  guardrails: GuardrailRow[];
  learners: LearnerRow[];
};

const Empty = ({ children }: { children: React.ReactNode }) => <p className="text-sm text-muted">{children}</p>;

function Processes({ rows, agentId, role }: { rows: ProcessRow[]; agentId: string; role: Role | null }) {
  if (rows.length === 0)
    return (
      <Empty>
        No confirmed processes yet.{" "}
        {canCapture(role) && (
          <Link className="underline" href={captureHref(agentId)}>
            Train it with a capture
          </Link>
        )}
      </Empty>
    );
  return (
    <ul className="flex flex-col divide-y divide-line text-sm">
      {rows.map((p) => (
        <li key={p.sessionId}>
          <Link href={p.href} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 hover:text-accent">
            <span className="font-medium">{p.task}</span>
            <span className="text-muted">{p.counts}</span>
            <span className="ml-auto font-mono text-xs text-muted">{p.date}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Shortcuts({ rows }: { rows: ShortcutRow[] }) {
  if (rows.length === 0)
    return <Empty>No shortcuts recorded yet. The companion records the chords the expert uses while training.</Empty>;
  return (
    <table className="w-full text-left text-sm">
      <thead className="text-xs text-muted">
        <tr>
          <th className="py-1 pr-3 font-normal">Chord</th>
          <th className="py-1 pr-3 font-normal">App</th>
          <th className="py-1 pr-3 font-normal">What it does</th>
          <th className="py-1 font-normal">Why</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((s) => (
          <tr key={`${s.chord}|${s.app}`}>
            <td className="py-2 pr-3">
              <kbd className="rounded border border-line bg-panel-2 px-1.5 py-0.5 font-mono text-xs">{s.chord}</kbd>
            </td>
            <td className="py-2 pr-3 text-muted">{s.app}</td>
            <td className="py-2 pr-3">{s.what}</td>
            <td className="py-2">{s.why && <q>{s.why}</q>}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Guardrails({ rows }: { rows: GuardrailRow[] }) {
  if (rows.length === 0) return <Empty>No guardrails yet. They come from the agent&apos;s confirmed Work Maps.</Empty>;
  return (
    <ul className="flex flex-col gap-3 text-sm">
      {rows.map((g, i) => (
        <li key={`${g.href}|${i}`} className="flex flex-col gap-1 border-b border-line pb-3">
          <span className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-line px-2 py-0.5 text-xs text-muted">{guardrailKindLabel(g.kind)}</span>
            <span className="font-medium">{g.rule}</span>
          </span>
          {g.quote && <q className="text-muted">{g.quote}</q>}
          <Link className="text-xs text-accent underline" href={g.href}>
            {g.task}, step {g.step} at {g.at}
          </Link>
        </li>
      ))}
    </ul>
  );
}

function Learners({ rows }: { rows: LearnerRow[] }) {
  if (rows.length === 0) return <Empty>Nobody has practised with this agent yet.</Empty>;
  return (
    <ul className="flex flex-col gap-4 text-sm">
      {rows.map((l) => (
        <li key={l.key} className="flex flex-col gap-1">
          <span className="flex flex-wrap items-baseline gap-2">
            <span className="font-medium">{l.label}</span>
            <span className="text-muted">{masteryText(l.mastered, l.steps)}</span>
          </span>
          <ul className="flex flex-col gap-1 pl-3">
            {l.processes.map((p) => (
              <li key={p.workmapSessionId} className="flex flex-wrap gap-x-3">
                <Link className="underline" href={`/map/${encodeURIComponent(p.workmapSessionId)}`}>
                  {p.task}
                </Link>
                <span className="text-muted">{masteryText(p.mastered, p.steps)}</span>
                <span className="text-muted">Interventions: {p.interventions}</span>
                <span className="font-mono text-xs text-muted">
                  {p.date}
                  {!p.finished && " (in progress)"}
                </span>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ul>
  );
}

export default function AgentDetail(props: AgentDetailProps) {
  const { agent, role, tab } = props;
  return (
    <main className="flex flex-col gap-6 p-4 sm:p-8">
      <header className={`${cardClass} sm:flex-row sm:items-center sm:gap-6`}>
        <AgentAvatar avatar={agent.avatar} size={144} />
        <div className="flex flex-1 flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight">{agent.name}</h1>
          <p className="text-muted">{agent.role}</p>
          <p className="text-sm text-muted">{expertLine(agent)}</p>
          <Stats stats={props.stats} />
          <div className="mt-2 flex flex-wrap gap-2 text-sm">
            {canCapture(role) && (
              <Link className="rounded-lg bg-accent px-3 py-1.5 text-accent-fg" href={captureHref(agent.id)}>
                Train (capture)
              </Link>
            )}
            <Link className="rounded-lg border border-line px-3 py-1.5 hover:bg-panel-2" href={learnHref(agent.id)}>
              Teach a new employee
            </Link>
          </div>
        </div>
      </header>
      <nav className="flex flex-wrap gap-1 border-b border-line text-sm" aria-label="Agent tabs">
        {AGENT_TABS.map((t) => (
          <Link
            key={t}
            href={agentHref(agent.id, t)}
            aria-current={t === tab ? "page" : undefined}
            className={`-mb-px border-b-2 px-3 py-2 ${t === tab ? "border-accent text-fg" : "border-transparent text-muted hover:text-fg"}`}
          >
            {TAB_LABELS[t]}
          </Link>
        ))}
      </nav>
      <section className={cardClass}>
        {tab === "processes" && <Processes rows={props.processes} agentId={agent.id} role={role} />}
        {tab === "shortcuts" && <Shortcuts rows={props.shortcuts} />}
        {tab === "guardrails" && <Guardrails rows={props.guardrails} />}
        {tab === "learners" && <Learners rows={props.learners} />}
        {tab === "settings" && <AgentSettings agent={agent} role={role} />}
      </section>
    </main>
  );
}
