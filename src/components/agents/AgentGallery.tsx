// Agent gallery (Gallery.dc.html, GalleryEmpty.dc.html): one card per agent plus the '+ New agent' card.
// The light and phone variants (GalleryLight, GalleryPhone) are the same markup under data-theme="light" and the
// narrow breakpoint; no separate route.
import Link from "next/link";
import { buttonClass } from "@/components/ui";
import AgentAvatar from "./AgentAvatar";
import { statText, type GalleryCard } from "./model";

export const cardClass = "ui-card flex flex-col";

export function Stats({ stats }: { stats: GalleryCard["stats"] }) {
  const items: [string, number | null][] = [
    ["Processes", stats.processes],
    ["Shortcuts", stats.shortcuts],
    ["Guardrails", stats.guardrails],
    ["Learners", stats.learners],
  ];
  return (
    <dl className="grid grid-cols-4 gap-1 border-t border-[var(--ln)] px-1 pt-3 pb-1">
      {items.map(([label, n]) => (
        <div key={label} className="flex flex-col-reverse">
          <dt className="text-xs" style={{ color: "var(--fa)" }}>{label}</dt>
          <dd className={n === null ? "text-sm" : "ui-t3 ui-mono"}>{statText(n)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function AgentCard({ card, href = card.href }: { card: GalleryCard; href?: string }) {
  return (
    <li>
      <Link href={href} className={`${cardClass} h-full gap-4 p-4 hover:border-[var(--ln2)]`}>
        <span className="flex h-44 items-center justify-center rounded-[12px]" style={{ background: "var(--stage)" }}>
          <AgentAvatar avatar={card.avatar} size={124} />
        </span>
        <span className="flex flex-col gap-1 px-1">
          <span className="ui-t2">{card.name}</span>
          <span className="text-[15px]" style={{ color: "var(--mu)" }}>{card.role}</span>
          <span className="mt-1 text-sm" style={{ color: "var(--mu)" }}>{card.expert}</span>
        </span>
        <Stats stats={card.stats} />
      </Link>
    </li>
  );
}

const EMPTY_STEPS = [
  ["1", "Name it", "Role and the expert it learns from"],
  ["2", "Give it a face", "Shape, face and colours in the studio"],
  ["3", "Train it", "The expert does one real task"],
] as const;

export function GalleryEmpty({ canCreate }: { canCreate: boolean }) {
  return (
    <div className="ui-card flex flex-col items-center gap-5 px-8 py-16 text-center" data-screen="gallery-empty">
      <div className="flex max-w-[480px] flex-col gap-2">
        <h2 className="ui-t2">No agents yet</h2>
        <p className="text-[15px]" style={{ color: "var(--mu)" }}>
          An agent learns from one expert while they work. Start with the person whose know-how you would miss most if they left tomorrow.
        </p>
        <p className="text-sm" style={{ color: "var(--fa)" }}>
          An agent learns one job from an expert while they do their real work, and asks at the right moments.
          <br />
          A new employee then picks the agent, and it teaches them the job and stops them before a guardrail breaks.
        </p>
      </div>
      {canCreate && (
        <Link href="/agents/new" className={buttonClass("primary")}>
          Create your first agent
        </Link>
      )}
      <div className="mt-4 grid w-full max-w-[720px] gap-3 sm:grid-cols-3">
        {EMPTY_STEPS.map(([n, title, text]) => (
          <div key={n} className="flex flex-col gap-1 rounded-[12px] p-4 text-left" style={{ background: "var(--s2)" }}>
            <span className="ui-mono text-xs" style={{ color: "var(--fa)" }}>{n}</span>
            <span className="text-sm font-semibold">{title}</span>
            <span className="text-xs" style={{ color: "var(--mu)" }}>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AgentGallery({ cards, canCreate }: { cards: GalleryCard[]; canCreate: boolean }) {
  return (
    <section className="flex flex-col gap-5" data-screen="gallery">
      <div className="flex flex-wrap items-baseline gap-3">
        <h2 className="ui-t2">Agents</h2>
        <span className="text-sm" style={{ color: "var(--fa)" }}>Each one learns from one expert</span>
      </div>
      {cards.length === 0 ? (
        <GalleryEmpty canCreate={canCreate} />
      ) : (
        <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
          {cards.map((c) => (
            <AgentCard key={c.id} card={c} />
          ))}
          {canCreate && (
            <li>
              <Link
                href="/agents/new"
                className={`${cardClass} ui-card-dashed h-full min-h-[380px] items-center justify-center gap-3.5 bg-transparent p-4 text-center`}
              >
                <span className="ui-t3">+ New agent</span>
                <span className="max-w-[220px] text-sm" style={{ color: "var(--mu)" }}>Name it, give it a face, then train it on real work.</span>
              </Link>
            </li>
          )}
        </ul>
      )}
    </section>
  );
}
