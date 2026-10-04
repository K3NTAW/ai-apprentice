"use client";

// Sidebar search field and the ⌘K command palette (Sidebar.dc.html search, Shell.dc.html palette). The keyboard,
// debounce and navigation rules live in ./palette; this file only renders the state.
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useSyncExternalStore, type RefObject } from "react";
import type { SearchResponse } from "@/lib/search/palette";
import { createPalette, type PaletteEntry, type PaletteState } from "./palette";

const noSubscribe = () => () => {};
const isMac = () => /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent);

/** '⌘K' on macOS, 'Ctrl K' elsewhere; the server render and first paint show '⌘K'. */
export function useChordHint(): string {
  return useSyncExternalStore(noSubscribe, () => (isMac() ? "⌘K" : "Ctrl K"), () => "⌘K");
}

async function fetchJson(url: string, signal: AbortSignal): Promise<SearchResponse> {
  const res = await fetch(url, { signal, headers: { accept: "application/json" } });
  if (!res.ok) throw new Error(`search ${res.status}`);
  return (await res.json()) as SearchResponse;
}

/** useRouter needs the mounted app router, so it runs in a child rendered only after mount (server renders skip it). */
function RouterRef({ target }: { target: RefObject<((href: string) => void) | null> }) {
  const router = useRouter();
  useEffect(() => {
    target.current = (href) => router.push(href);
  }, [router, target]);
  return null;
}

const searchIcon = (
  <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="11" cy="11" r="6.5" />
    <path d="m20 20-4.2-4.2" />
  </svg>
);

export function SearchField({ hint, onOpen }: { hint: string; onOpen?: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label="Search"
      aria-keyshortcuts="Meta+K Control+K"
      className="hidden items-center gap-[10px] md:flex"
      style={{ height: 40, padding: "0 8px 0 12px", borderRadius: 999, border: "1px solid var(--ln)", background: "var(--s1)", color: "var(--fa)", fontSize: 13, cursor: "pointer" }}
    >
      {searchIcon}
      <span className="flex-1 text-left md:group-data-[collapsed=true]:hidden">Search</span>
      <span className="ui-kc md:group-data-[collapsed=true]:hidden" style={{ height: 22, minWidth: 22, fontSize: 11 }}>
        {hint}
      </span>
    </button>
  );
}

function Results({ state, onChoose, onHover }: { state: PaletteState; onChoose: (i: number) => void; onHover: (i: number) => void }) {
  let prev: PaletteEntry["group"] | null = null;
  return (
    <div role="listbox" id="palette-list" aria-label="Results" className="flex flex-col" style={{ maxHeight: 380, overflowY: "auto", padding: 6 }}>
      {state.entries.map((e, i) => {
        const head = e.group !== prev ? e.group : null;
        prev = e.group;
        return (
          <div key={`${e.group}:${e.id}`} className="flex flex-col">
            {head && <div className="text-xs" style={{ color: "var(--fa)", padding: "8px 10px 4px" }}>{head}</div>}
            <div
              role="option"
              id={`palette-${i}`}
              aria-selected={i === state.active}
              className={i === state.active ? "ui-mi ui-on" : "ui-mi"}
              onMouseEnter={() => onHover(i)}
              onMouseDown={(ev) => {
                ev.preventDefault();
                onChoose(i);
              }}
            >
              <span className="flex-1 truncate">{e.title}</span>
              {e.detail && <span className="truncate text-xs" style={{ color: "var(--fa)", maxWidth: "45%" }}>{e.detail}</span>}
            </div>
          </div>
        );
      })}
      {!state.loading && state.query.trim() !== "" && state.entries.every((e) => e.group === "Actions") && (
        <div className="text-xs" style={{ color: "var(--fa)", padding: "8px 10px" }}>No matches in this workspace.</div>
      )}
    </div>
  );
}

export default function CommandPalette() {
  const hint = useChordHint();
  const [state, setState] = useState<PaletteState | null>(null);
  const [mounted, setMounted] = useState(false);
  const palette = useRef<ReturnType<typeof createPalette> | null>(null);
  const navigate = useRef<((href: string) => void) | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the router child mounts on the client only.
    setMounted(true);
    const p = createPalette({ fetchJson, navigate: (href) => (navigate.current ? navigate.current(href) : window.location.assign(href)), onChange: setState });
    palette.current = p;
    const onKey = (e: KeyboardEvent) => void p.keydown(e);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      p.dispose();
    };
  }, []);

  const open = state?.open ? state : null;
  return (
    <>
      {mounted && <RouterRef target={navigate} />}
      <SearchField hint={hint} onOpen={() => palette.current?.open()} />
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center" style={{ paddingTop: "12vh", background: "color-mix(in oklab, var(--bg) 60%, transparent)" }} onMouseDown={() => palette.current?.close()}>
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="ui-card"
            style={{ width: 560, maxWidth: "calc(100vw - 24px)", boxShadow: "var(--sh)", background: "var(--s1)", borderColor: "var(--ln2)" }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-[10px]" style={{ padding: "6px 14px", borderBottom: "1px solid var(--ln)", color: "var(--fa)" }}>
              {searchIcon}
              <input
                autoFocus
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-activedescendant={`palette-${open.active}`}
                aria-label="Search agents, Work Maps, guardrails and sessions"
                placeholder="Search agents, Work Maps, guardrails, sessions"
                value={open.query}
                onChange={(e) => palette.current?.search(e.target.value)}
                className="flex-1 bg-transparent outline-none"
                style={{ height: 44, color: "var(--tx)", fontSize: 14, border: 0 }}
              />
              <span className="ui-kc" style={{ height: 22, fontSize: 11 }}>Esc</span>
            </div>
            <Results state={open} onChoose={(i) => palette.current?.choose(i)} onHover={(i) => setState({ ...open, active: i })} />
          </div>
        </div>
      )}
    </>
  );
}
