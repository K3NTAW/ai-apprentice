"use client";
// Agents home (Gallery.dc.html top): greeting, the large input box and the gallery below.
// Typing searches the confirmed Work Maps and guardrails (src/lib/agents/home.ts); 'start a session' or the
// '+' button opens Capture (/capture?agent=<id>) with the agent from the picker pill. The mic dictates into the box,
// Send submits it. The chip row below links to Capture, Learn, the Work Maps and the workspace invites.
import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Badge, buttonClass } from "@/components/ui";
import { HOME_LABEL, HOME_PLACEHOLDER, homeAction, searchHome, type HomeEntry } from "@/lib/agents/home";
import AgentAvatar from "./AgentAvatar";
import AgentGallery, { PlusIcon } from "./AgentGallery";
import { captureHref, learnHref, type GalleryCard } from "./model";

function MicIcon({ size = 18 }: { size?: number }) {
  return (
    <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: size, height: size }} aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

type Recognition = { lang: string; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null; start: () => void };
type RecognitionCtor = new () => Recognition;
const recognitionCtor = (): RecognitionCtor | null => {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
};

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
  const selected = cards.find((c) => c.id === agentId) ?? null;
  // The mic dictates into the box where the browser supports speech recognition; disabled otherwise.
  const [speech, setSpeech] = useState(false);
  useEffect(() => setSpeech(recognitionCtor() !== null), []);
  function listen() {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = "en-GB";
    r.onresult = (e) => setQuery(Array.from(e.results, (res) => res[0]?.transcript ?? "").join(" ").trim());
    r.start();
  }

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
          style={{ background: "var(--cmp)", boxShadow: "0 1px 0 rgba(255,255,255,.04) inset" }}
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
            {startId && (
              <Link
                href={captureHref(startId)}
                className={buttonClass("secondary", "md", "h-9! w-9! p-0!")}
                aria-label="Start a session"
                title="Start a session"
                data-testid="home-start"
              >
                <PlusIcon />
              </Link>
            )}
            {selected && (
              <span className={buttonClass("secondary", "md", "relative h-9! gap-1.5! pr-3! pl-1.5!")} data-testid="home-agent-picker">
                <AgentAvatar avatar={selected.avatar} size={26} />
                {selected.name}
                <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: 14, height: 14 }} aria-hidden="true">
                  <path d="m7 10 5 5 5-5" />
                </svg>
                <select
                  aria-label="Agent"
                  value={agentId ?? ""}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="absolute inset-0 cursor-pointer opacity-0"
                >
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </span>
            )}
            <span className="flex-1" />
            <button
              type="button"
              aria-label="Speak"
              title={speech ? "Speak" : "Speaking is not supported in this browser"}
              disabled={!speech}
              onClick={listen}
              className={buttonClass("ghost", "md", "h-9! w-9! p-0! disabled:opacity-60")}
              style={{ background: "var(--fa)", color: "var(--tx)" }}
              data-testid="home-mic"
            >
              <MicIcon />
            </button>
            <button type="submit" aria-label="Send" className={buttonClass("primary", "md", "h-9! w-9! p-0!")} data-testid="home-send">
              <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 19V5M6 11l6-6 6 6" />
              </svg>
            </button>
          </div>
        </form>
        <nav aria-label="Shortcuts" className="flex flex-wrap justify-center gap-2" data-testid="home-chips">
          {startId && selected && (
            <Link href={captureHref(startId)} className={buttonClass("secondary")}>
              <MicIcon size={15} />
              Train {selected.name}
            </Link>
          )}
          <Link href={learnHref(selected?.id)} className={buttonClass("secondary")}>
            <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: 15, height: 15 }} aria-hidden="true">
              <path d="M3 7.5 12 4l9 3.5-9 3.5z" />
              <path d="M7 9.5V15c0 1.5 2.5 3 5 3s5-1.5 5-3V9.5" />
            </svg>
            Teach a new employee
          </Link>
          <Link href="/map" className={buttonClass("secondary")}>
            <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: 15, height: 15 }} aria-hidden="true">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="3" />
              <circle cx="19" cy="12" r="2" />
              <path d="M7 12h2M15 12h2" />
            </svg>
            Open a Work Map
          </Link>
          <Link href="/workspace" className={buttonClass("secondary")}>
            <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: 15, height: 15 }} aria-hidden="true">
              <circle cx="9" cy="8" r="3" />
              <path d="M3 19c0-3 2.7-5 6-5s6 2 6 5M19 8v6M16 11h6" />
            </svg>
            Invite an expert
          </Link>
        </nav>
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
