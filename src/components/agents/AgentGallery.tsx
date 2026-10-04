"use client";
// Agent gallery (Gallery.dc.html, GalleryEmpty.dc.html): header row with search and '+ New agent', the filter
// tabs (All, Ready to teach, Training), one card per agent plus the dashed '+ New agent' card.
// The light and phone variants (GalleryLight, GalleryPhone) are the same markup under data-theme="light" and the
// narrow breakpoint; no separate route.
import Link from "next/link";
import { useState } from "react";
import { Badge, buttonClass, Segmented } from "@/components/ui";
import { COMPANION_README } from "@/components/capture/CompanionCard";
import AgentAvatar from "./AgentAvatar";
import { EMPTY_AVATAR, filterCards, statText, type GalleryCard, type GalleryFilter } from "./model";

export const cardClass = "ui-card flex flex-col";

export function PlusIcon({ size = 18 }: { size?: number }) {
  return (
    <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: size, height: size }} aria-hidden="true">
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

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
      <Link href={href} className={`${cardClass} h-full gap-4 p-4 hover:border-[var(--ln2)]`} data-testid="agent-card">
        <span className="relative flex h-44 items-center justify-center rounded-[12px]" style={{ background: "var(--stage)" }}>
          <Badge kind={card.ready ? "confirmed" : "accent"} className="absolute top-3 left-3">
            {card.ready ? "Ready to teach" : "Training"}
          </Badge>
          <span className="absolute top-[13px] right-3 text-xs" style={{ color: "var(--fa)" }}>{card.last}</span>
          <AgentAvatar avatar={card.avatar} size={124} />
        </span>
        <span className="flex flex-col gap-1 px-1">
          <span className="ui-t2">{card.name}</span>
          <span className="text-[15px]" style={{ color: "var(--mu)" }}>{card.role}</span>
          {card.expertName ? (
            <span className="mt-1 flex items-center gap-2 text-[13px]">
              <span
                aria-hidden="true"
                className="inline-flex flex-none items-center justify-center rounded-full text-[10px] font-semibold"
                style={{ width: 22, height: 22, background: "var(--s3)", color: "var(--tx)" }}
              >
                {card.initials}
              </span>
              <span style={{ color: "var(--mu)" }}>learns from</span> {card.expertName}
            </span>
          ) : (
            <span className="mt-1 text-[13px]" style={{ color: "var(--mu)" }}>{card.expert}</span>
          )}
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
      <AgentAvatar avatar={EMPTY_AVATAR} size={140} />
      <div className="flex max-w-[480px] flex-col gap-2">
        <h2 className="ui-t2">No agents yet</h2>
        <p className="text-[15px]" style={{ color: "var(--mu)" }}>
          An agent learns from one expert while they work. Start with the person whose know-how you would miss most if they left tomorrow.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2.5">
        {canCreate && (
          <Link href="/agents/new" className={buttonClass("primary")}>
            <PlusIcon />
            Create your first agent
          </Link>
        )}
        <a href={COMPANION_README} target="_blank" rel="noreferrer" className={buttonClass("secondary")}>
          Install the companion
        </a>
      </div>
      <div className="mt-4 grid w-full max-w-[720px] gap-3 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        {EMPTY_STEPS.map(([n, title, text]) => (
          <div key={n} className="flex flex-col gap-1 rounded-[12px] p-4 text-left" style={{ background: "var(--s2)" }}>
            <span className="ui-mono text-xs" style={{ color: "var(--fa)" }}>{n}</span>
            <span className="text-[13px] font-semibold">{title}</span>
            <span className="text-xs" style={{ color: "var(--mu)" }}>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function AgentGallery({
  cards,
  canCreate,
  initialSearch = "",
  initialFilter = "all",
}: {
  cards: GalleryCard[];
  canCreate: boolean;
  /** Tests: the initial search text and filter tab. */
  initialSearch?: string;
  initialFilter?: GalleryFilter;
}) {
  const [search, setSearch] = useState(initialSearch);
  const [filter, setFilter] = useState<GalleryFilter>(initialFilter);
  const shown = filterCards(cards, search, filter);
  const ready = cards.filter((c) => c.ready).length;
  return (
    <section className="flex flex-col gap-7" data-screen="gallery">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h2 className="ui-t2">Agents</h2>
          <span className="text-[13px]" style={{ color: "var(--fa)" }}>Each one learns from one expert</span>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-[240px] max-w-full">
            <svg className="ui-ic absolute" viewBox="0 0 24 24" style={{ left: 13, top: 12, width: 16, height: 16, color: "var(--fa)" }} aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <label htmlFor="agent-search" className="sr-only">Search agents</label>
            <input
              id="agent-search"
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search agents or experts"
              className="ui-inp"
              style={{ height: 40, borderRadius: 999, borderColor: "var(--ln)", padding: "0 14px 0 38px" }}
            />
          </div>
          {canCreate && (
            <Link href="/agents/new" className={buttonClass("primary")} data-testid="new-agent-button">
              <PlusIcon />
              New agent
            </Link>
          )}
        </div>
      </div>
      {cards.length === 0 ? (
        <GalleryEmpty canCreate={canCreate} />
      ) : (
        <div className="flex flex-col gap-5">
          <Segmented
            label="Filter agents"
            active={filter}
            onSelect={(id) => setFilter(id as GalleryFilter)}
            items={[
              { id: "all", label: "All", count: cards.length },
              { id: "ready", label: "Ready to teach", count: ready },
              { id: "training", label: "Training", count: cards.length - ready },
            ]}
          />
          <ul className="grid gap-4 [grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr))]">
            {shown.map((c) => (
              <AgentCard key={c.id} card={c} />
            ))}
            {canCreate && (
              <li>
                <Link
                  href="/agents/new"
                  data-testid="new-agent-card"
                  className={`${cardClass} ui-card-dashed h-full min-h-[380px] items-center justify-center gap-3.5 bg-transparent p-4 text-center`}
                >
                  <span className="inline-flex items-center justify-center rounded-full" style={{ width: 56, height: 56, background: "var(--s2)", color: "var(--ac2)" }}>
                    <PlusIcon size={24} />
                  </span>
                  <span className="ui-t3">New agent</span>
                  <span className="max-w-[220px] text-[13px]" style={{ color: "var(--mu)" }}>Name it, give it a face, then train it on real work.</span>
                </Link>
              </li>
            )}
          </ul>
          {shown.length === 0 && <p className="text-[13px]" style={{ color: "var(--mu)" }}>No agent matches that search.</p>}
        </div>
      )}
    </section>
  );
}
