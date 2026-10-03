// Agent gallery: the post-login home. One card per agent plus the '+ New agent' card.
import Link from "next/link";
import AgentAvatar from "./AgentAvatar";
import { statText, type GalleryCard } from "./model";

export const cardClass = "flex flex-col gap-3 rounded-[16px] border border-line bg-panel p-5";

export function Stats({ stats }: { stats: GalleryCard["stats"] }) {
  const items: [string, number | null][] = [
    ["Processes", stats.processes],
    ["Shortcuts", stats.shortcuts],
    ["Guardrails", stats.guardrails],
    ["Learners", stats.learners],
  ];
  return (
    <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
      {items.map(([label, n]) => (
        <div key={label} className="flex justify-between gap-2">
          <dt className="text-muted">{label}</dt>
          <dd>{statText(n)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AgentCard({ card, href = card.href }: { card: GalleryCard; href?: string }) {
  return (
    <li>
      <Link href={href} className={`${cardClass} h-full hover:border-accent`}>
        <AgentAvatar avatar={card.avatar} size={72} />
        <span className="flex flex-col">
          <span className="font-semibold">{card.name}</span>
          <span className="text-sm text-muted">{card.role}</span>
          <span className="text-xs text-muted">{card.expert}</span>
        </span>
        <Stats stats={card.stats} />
      </Link>
    </li>
  );
}

export default function AgentGallery({ cards, canCreate }: { cards: GalleryCard[]; canCreate: boolean }) {
  return (
    <main className="flex flex-col gap-6 p-4 sm:p-8">
      <h1 className="text-xl font-semibold tracking-tight">Agents</h1>
      {cards.length === 0 && (
        <p className="max-w-xl text-sm text-muted">
          An agent learns one job from an expert while they do their real work, and asks at the right moments.
          <br />
          A new employee then picks the agent, and it teaches them the job and stops them before a guardrail breaks.
        </p>
      )}
      <ul className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {cards.map((c) => (
          <AgentCard key={c.id} card={c} />
        ))}
        {canCreate && (
          <li>
            <Link
              href="/agents/new"
              className={`${cardClass} h-full min-h-40 items-center justify-center border-dashed text-muted hover:border-accent hover:text-fg`}
            >
              + New agent
            </Link>
          </li>
        )}
      </ul>
    </main>
  );
}
