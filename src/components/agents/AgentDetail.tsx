// Agent page, 1:1 with docs/design/canvas/Agent.dc.html and its tab artboards (AgentShortcuts, AgentGuardrails,
// AgentLearners, AgentSettings): hero card with the big avatar, Train and Teach buttons, tabs with counts, ?tab= picks the first
// one and later switches are client-side (./AgentTabs). Data the app does not have (understood %, seen counts,
// learner avatars) is hidden.
import Link from "next/link";
import { canCapture } from "@/components/shell/ShellHeader";
import type { Role } from "@/lib/auth/context";
import type { Agent } from "@/lib/types";
import { guardrailKindLabel } from "@/lib/workmap/view";
import AgentAvatar from "./AgentAvatar";
import { Badge, Card, ScoreBar, buttonClass, type BadgeKind } from "@/components/ui";
import AgentTabs from "./AgentTabs";
import AgentSettings from "./AgentSettings";
import ShortcutsTab from "./ShortcutsTab";
import {
  captureHref,
  expertLine,
  learnHref,
  masteryText,
  statText,
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

const Empty = ({ children }: { children: React.ReactNode }) => (
  <Card style={{ padding: 22 }}>
    <p className="text-[13px]" style={{ color: "var(--mu)" }}>
      {children}
    </p>
  </Card>
);
const Intro = ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => (
  <div className="flex flex-wrap items-center justify-between" style={{ gap: 12 }}>
    <span style={{ color: "var(--mu)" }}>{children}</span>
    {action}
  </div>
);
const GUARD_KIND: Record<GuardrailRow["kind"], BadgeKind> = { limit: "limit", exception: "exception", stop_and_ask: "stop_and_ask" };
const quoteStyle = { fontFamily: "var(--font-serif, 'Instrument Serif', Georgia, serif)", fontStyle: "italic" as const, fontSize: 17, lineHeight: 1.3 };

function Processes({ rows, agentId, role }: { rows: ProcessRow[]; agentId: string; role: Role | null }) {
  const train = canCapture(role) && (
    <Link className={buttonClass("secondary", "sm")} href={captureHref(agentId)}>
      Train a new process
    </Link>
  );
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
    <div className="flex flex-col" style={{ gap: 14 }}>
      <Intro action={train}>Each process is one Work Map. The bar shows how well the agent understood it, with the 75% bar to clear.</Intro>
      <Card style={{ padding: "0 20px" }}>
        {rows.map((p) => (
          <div
            key={p.sessionId}
            className="grid items-center"
            style={{ gridTemplateColumns: "minmax(0, 2.2fr) minmax(0, 1.4fr) minmax(0, 1fr) auto", gap: 24, padding: "18px 0", borderBottom: "1px solid var(--ln)" }}
          >
            <div className="flex min-w-0 flex-col" style={{ gap: 3 }}>
              <span className="ui-t3">{p.task}</span>
              <span className="text-[13px]" style={{ color: "var(--mu)" }}>
                {p.counts}
              </span>
            </div>
            <ScoreBar label="Understood" value={p.understood} />
            <div className="flex flex-col items-start" style={{ gap: 4 }}>
              <Badge kind="confirmed" />
              <span className="ui-mono text-xs" style={{ color: "var(--fa)" }}>
                {p.date}
              </span>
            </div>
            <Link href={p.href} className={buttonClass("secondary", "sm")}>
              Open map
            </Link>
          </div>
        ))}
      </Card>
    </div>
  );
}

function Guardrails({ rows, agentId }: { rows: GuardrailRow[]; agentId: string }) {
  if (rows.length === 0) return <Empty>No guardrails yet. They come from the agent&apos;s confirmed Work Maps.</Empty>;
  const n = (k: GuardrailRow["kind"]) => rows.filter((g) => g.kind === k).length;
  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <div className="flex flex-wrap items-center justify-between" style={{ gap: 12 }}>
        <div className="flex flex-wrap" style={{ gap: 8 }}>
          <Badge kind="accent">All {rows.length}</Badge>
          <Badge kind="limit">Limit {n("limit")}</Badge>
          <Badge kind="exception">Exception {n("exception")}</Badge>
          <Badge kind="stop_and_ask">Stop and ask {n("stop_and_ask")}</Badge>
        </div>
        {/* agent-level export (GET /api/export?agent_id): every confirmed Work Map, one section per process */}
        <a className={buttonClass("secondary", "sm")} href={`/api/export?agent_id=${encodeURIComponent(agentId)}`} download={`guardrails-${agentId}.md`}>
          <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: 16, height: 16 }} aria-hidden="true">
            <path d="M12 4v11M7 10l5 5 5-5M5 20h14" />
          </svg>
          Export guardrails
        </a>
      </div>
      <div className="flex flex-col" style={{ gap: 10 }}>
        {rows.map((g, i) => (
          <Card key={`${g.href}|${i}`} className="grid items-start" style={{ padding: "18px 20px", gridTemplateColumns: "120px minmax(0, 1fr) auto", gap: 20 }}>
            <Badge kind={GUARD_KIND[g.kind]} className="justify-self-start">
              {guardrailKindLabel(g.kind)}
            </Badge>
            <div className="flex min-w-0 flex-col" style={{ gap: 8 }}>
              <span className="ui-t3">{g.rule}</span>
              {g.quote && (
                <q data-testid="guardrail-quote" style={{ ...quoteStyle, color: "var(--mu)" }}>
                  {g.quote}
                </q>
              )}
              <span className="text-xs" style={{ color: "var(--fa)" }}>
                {g.task} · step {g.step}
              </span>
            </div>
            <div className="flex flex-col items-end" style={{ gap: 8 }}>
              <Link className={buttonClass("secondary", "sm")} href={g.href}>
                <svg className="ui-ic" data-testid="play-icon" viewBox="0 0 24 24" style={{ width: 14, height: 14 }} aria-hidden="true">
                  <path d="M8 5v14l11-7z" />
                </svg>
                Screen moment <span className="ui-mono">{g.at}</span>
              </Link>
              {/* every row comes from a Work Map the expert confirmed */}
              <Badge kind="confirmed">Confirmed</Badge>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
}

const LEARNER_COLS = "minmax(0, 1.3fr) minmax(0, 1.2fr) 220px 130px";

function Learners({ rows }: { rows: LearnerRow[] }) {
  if (rows.length === 0) return <Empty>Nobody has practised with this agent yet.</Empty>;
  return (
    <div className="flex flex-col" style={{ gap: 14 }}>
      <Intro>Mastery is per step. A step is mastered when the learner gets it right on their own screen, twice.</Intro>
      <Card style={{ overflowX: "auto" }}>
        <div role="table" aria-label="Learners" style={{ minWidth: 820 }}>
          <div role="row" className="grid text-xs" style={{ gridTemplateColumns: LEARNER_COLS, gap: 20, padding: "12px 20px", borderBottom: "1px solid var(--ln)", fontWeight: 500, color: "var(--fa)" }}>
            <span role="columnheader">Learner</span>
            <span role="columnheader">Process</span>
            <span role="columnheader">Mastery</span>
            <span role="columnheader">Last session</span>
          </div>
          {rows.flatMap((l) =>
            l.processes.map((p, k) => {
              const pct = p.steps ? Math.round((p.mastered / p.steps) * 100) : 0;
              const done = p.steps > 0 && p.mastered >= p.steps;
              return (
                <div key={`${l.key}|${p.workmapSessionId}`} role="row" className="grid items-center" style={{ gridTemplateColumns: LEARNER_COLS, gap: 20, padding: "16px 20px", borderBottom: "1px solid var(--ln)" }}>
                  <span role="cell" className="flex flex-col">
                    {k === 0 && (
                      <>
                        <span style={{ fontWeight: 500 }}>{l.label}</span>
                        <span className="text-xs" style={{ color: "var(--fa)" }}>
                          {masteryText(l.mastered, l.steps)}
                        </span>
                      </>
                    )}
                  </span>
                  <span role="cell" className="flex flex-col">
                    <Link className="no-underline" style={{ color: "var(--tx)" }} href={`/map/${encodeURIComponent(p.workmapSessionId)}`}>
                      {p.task}
                    </Link>
                    <span className="text-xs" style={{ color: "var(--fa)" }}>
                      Interventions: {p.interventions}
                    </span>
                  </span>
                  <span role="cell" className="flex flex-col" style={{ gap: 8 }}>
                    <span className="flex items-center justify-between text-xs">
                      <Badge kind={done ? "confirmed" : "judgment"}>{done ? "Mastered" : "Practice next"}</Badge>
                      <span className="ui-mono" style={{ color: "var(--mu)" }}>
                        {p.mastered} of {p.steps} steps
                      </span>
                    </span>
                    <span className="ui-bar block">
                      <i style={{ width: `${pct}%`, background: "var(--gr)" }} />
                    </span>
                  </span>
                  <span role="cell" className="ui-mono text-[13px]" style={{ color: "var(--mu)" }}>
                    {p.date}
                    {!p.finished && " (in progress)"}
                  </span>
                </div>
              );
            }),
          )}
        </div>
      </Card>
    </div>
  );
}

export default function AgentDetail(props: AgentDetailProps) {
  const { agent, role, tab, stats } = props;
  const counts: Record<AgentTab, number | undefined> = {
    processes: stats.processes,
    shortcuts: stats.shortcuts ?? undefined,
    guardrails: stats.guardrails,
    learners: stats.learners,
    settings: undefined,
  };
  const stat = (n: number | null, label: string) => (
    <span>
      <span className="ui-mono" style={{ color: "var(--tx)" }}>
        {statText(n)}
      </span>{" "}
      {label}
    </span>
  );
  return (
    <main className="flex min-w-0 flex-col" style={{ padding: "28px 40px 56px", gap: 24 }}>
      <Link className="text-[13px] no-underline" style={{ color: "var(--mu)" }} href="/agents">
        Agents / {agent.name}
      </Link>
      <Card className="flex flex-wrap overflow-hidden" style={{ padding: 0 }}>
        <div className="flex items-center justify-center" style={{ flex: "0 0 220px", minHeight: 220, background: "var(--stage)" }}>
          <AgentAvatar avatar={agent.avatar} size={168} />
        </div>
        <div className="flex min-w-0 flex-col justify-center" style={{ flex: "1 1 420px", padding: "28px 32px", gap: 14 }}>
          <div className="flex flex-wrap items-center" style={{ gap: 12 }}>
            <h1 className="ui-td">{agent.name}</h1>
            {stats.processes > 0 && <Badge kind="confirmed">Ready to teach</Badge>}
          </div>
          <div className="flex flex-col" style={{ gap: 4 }}>
            <span style={{ fontSize: 17 }}>{agent.role}</span>
            <span style={{ color: "var(--mu)" }}>{expertLine(agent)}</span>
          </div>
          <div className="flex flex-wrap text-[13px]" style={{ gap: 20, color: "var(--mu)" }} data-testid="agent-stats">
            {stat(stats.processes, "processes")}
            {stat(stats.shortcuts, "shortcuts")}
            {stat(stats.guardrails, "guardrails")}
            {stat(stats.learners, "learners")}
            {stats.last_trained && <span>Last trained {stats.last_trained.slice(0, 10)}</span>}
          </div>
        </div>
        <div className="flex flex-col justify-center" style={{ flex: "0 1 auto", padding: "28px 32px", gap: 10 }}>
          {canCapture(role) && (
            <Link className={buttonClass("primary", "lg")} href={captureHref(agent.id)}>
              <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3" /><path d="M5 11a7 7 0 0 0 14 0M12 18v3" /></svg>
              Train
            </Link>
          )}
          <Link className={buttonClass("secondary", "lg")} href={learnHref(agent.id)}>
            <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5 12 4l9 3.5-9 3.5z" /><path d="M7 9.5V15c0 1.5 2.5 3 5 3s5-1.5 5-3V9.5" /></svg>
            Teach a new employee
          </Link>
        </div>
      </Card>
      <AgentTabs
        agentId={agent.id}
        initial={tab}
        counts={counts}
        panels={{
          processes: <Processes rows={props.processes} agentId={agent.id} role={role} />,
          shortcuts:
            props.shortcuts.length === 0 ? (
              <Empty>No shortcuts recorded yet. The companion records the chords the expert uses while training.</Empty>
            ) : (
              <div className="flex flex-col" style={{ gap: 14 }}>
                <ShortcutsTab rows={props.shortcuts} expert={agent.expert_name ?? "the expert"} />
              </div>
            ),
          guardrails: <Guardrails rows={props.guardrails} agentId={agent.id} />,
          learners: <Learners rows={props.learners} />,
          settings: <AgentSettings agent={agent} role={role} workMaps={stats.processes} />,
        }}
      />
    </main>
  );
}
