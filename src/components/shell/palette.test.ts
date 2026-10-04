// The ⌘K command palette rules (./palette): chord opens, one debounced request per pause, arrows, Enter, Esc;
// and the collapse state in localStorage with try/catch (./SidebarFrame).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SearchResponse } from "@/lib/search/palette";
import { createPalette, isPaletteChord, paletteActions, SEARCH_DEBOUNCE_MS } from "./palette";
import { collapseKey, readCollapsed, writeCollapsed } from "./SidebarFrame";

const res: SearchResponse = {
  agents: [{ id: "a1", title: "Pip", detail: "Supplier invoices", href: "/agents/a1" }],
  workmaps: [{ id: "m1", title: "Supplier invoices", detail: "4 steps", href: "/map/m1" }],
  guardrails: [],
  sessions: [],
};

function setup() {
  const fetchJson = vi.fn(async () => res);
  const navigate = vi.fn();
  const p = createPalette({ fetchJson, navigate, onChange: () => {} });
  return { p, fetchJson, navigate };
}

describe("command palette", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("⌘K and Ctrl+K open it anywhere; Esc closes", () => {
    const { p } = setup();
    expect(isPaletteChord({ key: "k", metaKey: true })).toBe(true);
    expect(isPaletteChord({ key: "K", ctrlKey: true })).toBe(true);
    expect(isPaletteChord({ key: "k" })).toBe(false);
    const preventDefault = vi.fn();
    expect(p.keydown({ key: "k", metaKey: true, preventDefault })).toBe(true);
    expect(preventDefault).toHaveBeenCalled();
    expect(p.get().open).toBe(true);
    p.keydown({ key: "Escape" });
    expect(p.get().open).toBe(false);
    p.keydown({ key: "k", ctrlKey: true });
    expect(p.get().open).toBe(true);
    expect(p.keydown({ key: "a" })).toBe(false);
  });

  it("typing sends one debounced request for the last query", async () => {
    const { p, fetchJson } = setup();
    p.open();
    for (const q of ["s", "su", "sup"]) {
      p.search(q);
      vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS - 1);
    }
    expect(fetchJson).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    await vi.runAllTimersAsync();
    expect(fetchJson).toHaveBeenCalledTimes(1);
    expect(fetchJson.mock.calls[0]![0]).toBe("/api/search?q=sup");
    expect(p.get().entries.map((e) => e.title)).toContain("Supplier invoices");
  });

  it("arrow keys move and Enter navigates to the active entry, then closes", async () => {
    const { p, navigate } = setup();
    p.keydown({ key: "k", metaKey: true });
    await vi.runAllTimersAsync();
    const titles = p.get().entries.map((e) => e.title);
    expect(titles).toEqual(["New agent", "Train Pip", "Teach a new employee", "Workspace", "Pip", "Supplier invoices"]);
    p.keydown({ key: "ArrowDown" });
    p.keydown({ key: "ArrowDown" });
    p.keydown({ key: "ArrowUp" });
    expect(p.get().active).toBe(1);
    p.keydown({ key: "Enter" });
    expect(navigate).toHaveBeenCalledWith("/capture?agent=a1");
    expect(p.get().open).toBe(false);
    p.keydown({ key: "ArrowUp" });
    expect(p.get().active).toBe(0);
  });

  it("actions filter by the query", () => {
    expect(paletteActions("teach", []).map((a) => a.title)).toEqual(["Teach a new employee"]);
    expect(paletteActions("", [{ id: "x", title: "Nova", detail: "", href: "" }]).map((a) => a.href)).toContain("/capture?agent=x");
  });
});

describe("sidebar collapse state", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("is remembered per viewer and survives a throwing localStorage", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => store.set(k, v) } });
    writeCollapsed("sabine@example.com", true);
    expect(store.get(collapseKey("sabine@example.com"))).toBe("1");
    expect(readCollapsed("sabine@example.com")).toBe(true);
    expect(readCollapsed("lena@example.com")).toBe(false);
    vi.stubGlobal("window", { localStorage: { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("quota"); } } });
    expect(readCollapsed("sabine@example.com")).toBe(false);
    expect(() => writeCollapsed("sabine@example.com", true)).not.toThrow();
  });
});
