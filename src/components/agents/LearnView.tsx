// Learn: pick an agent (only agents with a confirmed process), then a process, then Teach starts with ?agent&session.
import Link from "next/link";
import AgentAvatar from "./AgentAvatar";
import { AgentCard, cardClass } from "./AgentGallery";
import { learnHref, type GalleryCard, type ProcessRow } from "./model";

export type LearnViewProps = {
  agents: GalleryCard[];
  selected: GalleryCard | null;
  processes: (ProcessRow & { teachHref: string })[];
  unknownAgent: boolean;
};

export default function LearnView({ agents, selected, processes, unknownAgent }: LearnViewProps) {
  return (
    <main className="flex flex-col gap-6 p-4 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Learn</h1>
      {unknownAgent && (
        <p role="alert" className="text-sm text-red-500">
          That agent is not available to learn from. Pick one below.
        </p>
      )}
      {selected ? (
        <>
          <div className="flex items-center gap-4">
            <AgentAvatar avatar={selected.avatar} size={72} />
            <div className="flex flex-col">
              <span className="font-semibold">{selected.name}</span>
              <span className="text-sm text-muted">{selected.role}</span>
            </div>
            <Link className="ml-auto text-sm text-muted underline" href={learnHref()}>
              Pick another agent
            </Link>
          </div>
          <p className="text-sm text-muted">Pick a process to practise.</p>
          <ul className="flex flex-col gap-3">
            {processes.map((p) => (
              <li key={p.sessionId}>
                <Link href={p.teachHref} className={`${cardClass} hover:border-accent`}>
                  <span className="font-medium">{p.task}</span>
                  <span className="text-sm text-muted">{p.counts}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : agents.length === 0 ? (
        <p className="text-sm text-muted">No agent has a confirmed process yet. Ask an expert to train one.</p>
      ) : (
        <>
          <p className="text-sm text-muted">Pick the agent that knows the job you are learning.</p>
          <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {agents.map((c) => (
              <AgentCard key={c.id} card={c} href={learnHref(c.id)} />
            ))}
          </ul>
        </>
      )}
    </main>
  );
}
