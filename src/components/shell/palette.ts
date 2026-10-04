// Command palette state, framework-free so the keyboard and debounce rules are testable without a DOM.
// ⌘K (Ctrl+K off macOS) toggles it anywhere; typing fetches /api/search once per pause (SEARCH_DEBOUNCE_MS, the previous
// request aborted); ArrowUp/ArrowDown move, Enter opens the active entry, Esc closes.
import type { SearchHit, SearchResponse } from "@/lib/search/palette";

export const SEARCH_DEBOUNCE_MS = 180;

export type PaletteEntry = SearchHit & { group: "Actions" | "Agents" | "Work Maps" | "Guardrails" | "Recent sessions" };
export type PaletteState = { open: boolean; query: string; entries: PaletteEntry[]; active: number; loading: boolean };
export type PaletteKey = { key: string; metaKey?: boolean; ctrlKey?: boolean; preventDefault?: () => void };

export const isPaletteChord = (e: PaletteKey) => !!(e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k";

/** The fixed actions, filtered by the query; 'Train <agent>' for each agent the search returned. */
export function paletteActions(query: string, agents: SearchHit[]): PaletteEntry[] {
  const q = query.trim().toLowerCase();
  const all: PaletteEntry[] = [
    { group: "Actions", id: "new-agent", title: "New agent", detail: "", href: "/agents/new" },
    ...agents.map((a) => ({ group: "Actions" as const, id: `train-${a.id}`, title: `Train ${a.title}`, detail: "", href: `/capture?agent=${encodeURIComponent(a.id)}` })),
    { group: "Actions", id: "teach", title: "Teach a new employee", detail: "", href: "/learn" },
    { group: "Actions", id: "workspace", title: "Workspace", detail: "", href: "/workspace" },
  ];
  return q ? all.filter((a) => a.id.startsWith("train-") || q.split(/\s+/).every((w) => a.title.toLowerCase().includes(w))) : all;
}

export function paletteEntries(query: string, res: SearchResponse | null): PaletteEntry[] {
  const r = res ?? { agents: [], workmaps: [], guardrails: [], sessions: [] };
  return [
    ...paletteActions(query, r.agents),
    ...r.agents.map((h) => ({ ...h, group: "Agents" as const })),
    ...r.workmaps.map((h) => ({ ...h, group: "Work Maps" as const })),
    ...r.guardrails.map((h) => ({ ...h, group: "Guardrails" as const })),
    ...r.sessions.map((h) => ({ ...h, group: "Recent sessions" as const })),
  ];
}

type Deps = {
  fetchJson: (url: string, signal: AbortSignal) => Promise<SearchResponse>;
  navigate: (href: string) => void;
  onChange: (s: PaletteState) => void;
};

export function createPalette({ fetchJson, navigate, onChange }: Deps) {
  let state: PaletteState = { open: false, query: "", entries: paletteEntries("", null), active: 0, loading: false };
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inflight: AbortController | null = null;
  const set = (patch: Partial<PaletteState>) => {
    state = { ...state, ...patch };
    onChange(state);
  };
  const cancel = () => {
    if (timer) clearTimeout(timer);
    timer = null;
    inflight?.abort();
    inflight = null;
  };
  const search = (query: string) => {
    cancel();
    set({ query, active: 0, loading: true, entries: paletteEntries(query, null) });
    timer = setTimeout(() => {
      timer = null;
      const ctrl = new AbortController();
      inflight = ctrl;
      fetchJson(`/api/search?q=${encodeURIComponent(query.trim())}`, ctrl.signal)
        .then((res) => {
          if (ctrl.signal.aborted) return;
          set({ entries: paletteEntries(query, res), loading: false, active: 0 });
        })
        .catch(() => {
          if (!ctrl.signal.aborted) set({ loading: false });
        });
    }, SEARCH_DEBOUNCE_MS);
  };
  const open = () => {
    if (state.open) return;
    set({ open: true });
    search("");
  };
  const close = () => {
    cancel();
    set({ open: false, query: "", active: 0, loading: false });
  };
  const choose = (i = state.active) => {
    const e = state.entries[i];
    if (!e) return;
    close();
    navigate(e.href);
  };
  /** Global keydown: the chord toggles; the rest only while open. Returns true when handled. */
  const keydown = (e: PaletteKey): boolean => {
    if (isPaletteChord(e)) {
      e.preventDefault?.();
      if (state.open) close();
      else open();
      return true;
    }
    if (!state.open) return false;
    const n = state.entries.length;
    if (e.key === "Escape") close();
    else if (e.key === "ArrowDown" && n) set({ active: (state.active + 1) % n });
    else if (e.key === "ArrowUp" && n) set({ active: (state.active - 1 + n) % n });
    else if (e.key === "Enter") choose();
    else return false;
    e.preventDefault?.();
    return true;
  };
  return { get: () => state, open, close, search, choose, keydown, dispose: cancel };
}
