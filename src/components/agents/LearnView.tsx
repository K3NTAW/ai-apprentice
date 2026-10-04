// Learn, 1:1 with docs/design/canvas/Learn.dc.html: three cards, 1 Agent (only agents with a confirmed process),
// 2 Process, 3 Start; Teach starts with ?agent&session. Selection is in the URL (?agent=), so options are links.
import Link from "next/link";
import type { CSSProperties, ReactNode } from "react";
import { buttonClass, Card } from "@/components/ui";
import AgentAvatar from "./AgentAvatar";
import { learnHref, type GalleryCard, type ProcessRow } from "./model";

export type LearnViewProps = {
  agents: GalleryCard[];
  selected: GalleryCard | null;
  processes: (ProcessRow & { teachHref: string })[];
  unknownAgent: boolean;
};

const opt = (on: boolean): CSSProperties => ({
  display: "flex",
  alignItems: "center",
  gap: 12,
  width: "100%",
  padding: 12,
  borderRadius: 12,
  border: `1px solid ${on ? "var(--ac)" : "var(--ln)"}`,
  boxShadow: on ? "0 0 0 1px var(--ac)" : undefined,
  background: on ? "var(--acs)" : "var(--s2)",
  color: "var(--tx)",
  textDecoration: "none",
  fontSize: 14,
});
const radio = (on: boolean) => (
  <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: "50%", border: on ? "5px solid var(--ac)" : "1.5px solid var(--ln2)", flex: "none", marginLeft: "auto" }} />
);

function Column({ n, title, children, style }: { n: number; title: string; children: ReactNode; style?: CSSProperties }) {
  return (
    <Card className="flex min-w-0 flex-col" style={{ padding: 18, gap: 10, ...style }}>
      <div className="flex items-center" style={{ gap: 10 }}>
        <span
          className="ui-mono inline-flex items-center justify-center text-xs"
          style={{ width: 22, height: 22, borderRadius: "50%", background: "var(--pb)", color: "var(--pf)" }}
        >
          {n}
        </span>
        <span className="ui-t3">{title}</span>
      </div>
      {children}
    </Card>
  );
}

export default function LearnView({ agents, selected, processes, unknownAgent }: LearnViewProps) {
  const first = processes[0] ?? null;
  return (
    <main className="flex min-w-0 flex-col" style={{ padding: "36px 40px 56px", gap: 26 }}>
      <div className="flex flex-col" style={{ gap: 6, maxWidth: 680 }}>
        <h1 className="ui-t1">Learn</h1>
        <p style={{ color: "var(--mu)", fontSize: 15 }}>
          Pick an agent, then a process. It teaches you on your own screen through the companion, next to your cursor.
        </p>
      </div>
      {unknownAgent && (
        <p role="alert" className="text-[13px]" style={{ color: "var(--rd)" }}>
          That agent is not available to learn from. Pick one below.
        </p>
      )}
      {agents.length === 0 ? (
        <Card style={{ padding: 22 }}>
          <p className="text-[13px]" style={{ color: "var(--mu)" }}>
            No agent has a confirmed process yet. Ask an expert to train one.
          </p>
        </Card>
      ) : (
        <div className="grid items-start" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 300px), 1fr))", gap: 16 }}>
          <Column n={1} title="Agent">
            {agents.map((c) => {
              const on = c.id === selected?.id;
              return (
                <Link key={c.id} href={learnHref(c.id)} aria-current={on ? "true" : undefined} style={opt(on)}>
                  <AgentAvatar avatar={c.avatar} size={44} />
                  <span className="flex min-w-0 flex-col">
                    <span style={{ fontWeight: 600 }}>{c.name}</span>
                    <span className="text-xs" style={{ color: "var(--mu)" }}>
                      {c.role} · {c.expert.replace(/^learns /, "")}
                    </span>
                  </span>
                  {radio(on)}
                </Link>
              );
            })}
          </Column>
          <Column n={2} title="Process">
            {!selected && <span className="text-[13px]" style={{ color: "var(--mu)" }}>Pick the agent that knows the job you are learning.</span>}
            {selected &&
              processes.map((p) => (
                <Link key={p.sessionId} href={p.teachHref} style={opt(p === first)}>
                  <span className="flex min-w-0 flex-col" style={{ gap: 4 }}>
                    <span style={{ fontWeight: 600 }}>{p.task}</span>
                    <span className="text-xs" style={{ color: "var(--mu)" }}>
                      {p.counts}
                    </span>
                  </span>
                  {radio(p === first)}
                </Link>
              ))}
          </Column>
          {selected && first && (
            <Column n={3} title="Start" style={{ padding: 22, gap: 18, background: "var(--stage)" }}>
              <div className="flex items-center" style={{ gap: 14 }}>
                <AgentAvatar avatar={selected.avatar} size={88} />
                <div className="flex min-w-0 flex-col" style={{ gap: 2 }}>
                  <span className="text-[13px]" style={{ color: "var(--mu)" }}>
                    {selected.name} teaches
                  </span>
                  <span className="ui-t2">{first.task}</span>
                </div>
              </div>
              <Link className={buttonClass("primary", "lg")} style={{ width: "100%" }} href={first.teachHref}>
                Start
              </Link>
              <span className="text-center text-xs" style={{ color: "var(--fa)" }}>
                {selected.name} appears next to your cursor. Say &ldquo;off the record&rdquo; any time.
              </span>
              <Link className="text-center text-[13px]" style={{ color: "var(--mu)" }} href={learnHref()}>
                Pick another agent
              </Link>
            </Column>
          )}
        </div>
      )}
    </main>
  );
}
