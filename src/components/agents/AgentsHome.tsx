"use client";
// Agents home (Gallery.dc.html top): greeting, the large input box and the gallery below.
// Typing searches the confirmed Work Maps and guardrails (src/lib/agents/home.ts); 'start a session' or the
// Start button opens Capture (/capture?agent=<id>) with the selected agent.
import Link from "next/link";
import { useMemo, useState, type FormEvent } from "react";
import { Badge, buttonClass } from "@/components/ui";
import { HOME_LABEL, HOME_PLACEHOLDER, homeAction, searchHome, type HomeEntry } from "@/lib/agents/home";
import AgentGallery from "./AgentGallery";
import { captureHref, type GalleryCard } from "./model";

export type AgentsHomeProps = {
  greeting: string;
  cards: GalleryCard[];
  canCreate: boolean;
  index: HomeEntry[];
  /** Tests: the initial text in the box. */
  initialQuery?: string;
  navigate?: (href: string) => void;
};

export default function AgentsHome({ greeting, cards, canCreate, index, initialQuery = "", navigate }: AgentsHomeProps) {
  const [query, setQuery] = useState(initialQuery);
  const [agentId, setAgentId] = useState<string | null>(cards[0]?.id ?? null);
  const startId = canCreate ? agentId : null;
  const action = useMemo(() => homeAction(query, index, startId), [query, index, startId]);
  const results = action.kind === "search" ? action.results : searchHome(query, index);

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (action.kind === "start") (navigate ?? ((h: string) => location.assign(h)))(action.href);
  }

  return (
    <main className="flex flex-col gap-7 px-4 pt-10 pb-14 sm:px-10" data-screen="agents-home">
      <section className="flex flex-col items-center gap-[22px] pt-7 pb-3">
        <h1 className="ui-t1 text-center" style={{ fontWeight: 500 }}>{greeting}</h1>
        <form
          onSubmit={onSubmit}
          role="search"
          className="flex w-full max-w-[760px] flex-col gap-3.5 rounded-[28px] border border-[var(--ln2)] py-3.5 pr-3.5 pb-3 pl-5"
          style={{ background: "var(--cmp)" }}
        >
          <label htmlFor="home-ask" className="sr-only">{HOME_LABEL}</label>
          <input
            id="home-ask"
            type="text"
            value={query}
            placeholder={HOME_PLACEHOLDER}
            onChange={(e) => setQuery(e.target.value)}
            className="h-8 w-full border-0 bg-transparent text-[17px] outline-none"
            style={{ color: "var(--tx)" }}
          />
          <div className="flex items-center gap-2">
            {canCreate && cards.length > 0 && (
              <select
                aria-label="Agent"
                value={agentId ?? ""}
                onChange={(e) => setAgentId(e.target.value)}
                className={buttonClass("ghost", "sm")}
              >
                {cards.map((c) => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
            )}
            <span className="flex-1" />
            {startId && (
              <Link href={captureHref(startId)} className={buttonClass("primary", "sm")} data-testid="home-start">
                Start a session
              </Link>
            )}
          </div>
        </form>
        {canCreate && cards.length === 0 && (
          <p className="text-sm" style={{ color: "var(--mu)" }}>Create an agent first, then start a session with it.</p>
        )}
        {(results.length > 0 || (action.kind === "search" && action.message)) && (
          <div className="flex w-full max-w-[760px] flex-col gap-2" data-testid="home-results">
            {action.kind === "search" && action.message && <p className="text-sm" style={{ color: "var(--mu)" }}>{action.message}</p>}
            <ul className="flex flex-col gap-2">
              {results.map((r) => (
                <li key={r.href}>
                  <Link href={r.href} className="ui-card flex flex-col gap-1.5 p-4">
                    <span className="text-xs" style={{ color: "var(--fa)" }}>{r.agentName} · {r.task}</span>
                    <span className="text-sm font-medium">{r.step}</span>
                    {r.guardrails.map((g) => (
                      <span key={g.rule} className="flex items-center gap-2 text-sm">
                        <Badge kind={g.kind} />
                        <span style={{ color: "var(--mu)" }}>{g.rule}</span>
                      </span>
                    ))}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>
      <AgentGallery cards={cards} canCreate={canCreate} />
    </main>
  );
}
