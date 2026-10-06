// @vitest-environment jsdom
// CostCard: one line per day with CHF, tokens, voice minutes and frame MB; "not priced" for chf null, a partial total
// when unpriced_events > 0, the voice footnote, the truncated note and the empty state.
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CostRow } from "@/app/api/workspace/cost/cost";
import CostCard from "./CostCard";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root | null = null;

const row = (day: string, kind: CostRow["kind"], extra: Partial<CostRow> = {}): CostRow => ({
  day,
  kind,
  events: 1,
  input_tokens: 1000,
  output_tokens: 200,
  cache_read_tokens: 0,
  voice_seconds: null,
  bytes: null,
  chf: 0.5,
  unpriced_events: 0,
  ...extra,
});

async function render(body: unknown) {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: string) => {
    urls.push(url);
    return Response.json(body);
  });
  await act(async () => {
    root = createRoot(host);
    root.render(<CostCard />);
  });
  await act(async () => {});
  return { text: host.textContent ?? "", urls };
}

beforeEach(() => {
  host = document.createElement("div");
  document.body.appendChild(host);
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host.remove();
  vi.unstubAllGlobals();
});

describe("CostCard", () => {
  it("renders one row per day with CHF, tokens, voice minutes and frame MB", async () => {
    const { text, urls } = await render({
      days: 30,
      truncated: false,
      rows: [
        row("2026-10-06", "vision", { chf: 1.234 }),
        row("2026-10-06", "voice", { input_tokens: null, output_tokens: null, voice_seconds: 90, chf: 0.1 }),
        row("2026-10-06", "frame", { input_tokens: null, output_tokens: null, bytes: 2_500_000, chf: null }),
        row("2026-10-05", "decide", { chf: 0.02 }),
      ],
    });
    expect(urls).toEqual(["/api/workspace/cost"]);
    expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
    const first = host.querySelectorAll("tbody tr")[0].textContent;
    expect(first).toContain("2026-10-06");
    expect(first).toContain("1.33");
    expect(first).toContain("1200");
    expect(first).toContain("1.5");
    expect(first).toContain("2.50");
    expect(text).toContain("Total CHF 1.35");
    expect(text).not.toContain("partial");
    expect(text).toContain("Voice is client-reported.");
    expect(text).not.toContain("showing the latest 500 rows");
  });

  it("shows not priced for a kind with chf null", async () => {
    const { text } = await render({ days: 30, truncated: false, rows: [row("2026-10-06", "frame", { chf: null, bytes: 1000 })] });
    expect(text).toContain("frame not priced");
  });

  it("labels the total partial when any row has unpriced events", async () => {
    const { text } = await render({
      days: 30,
      truncated: true,
      rows: [row("2026-10-06", "vision", { chf: null, unpriced_events: 2 }), row("2026-10-06", "decide")],
    });
    expect(text).toContain("Total CHF 0.50 (partial)");
    expect(text).toContain("Some events have no price yet");
    expect(text).toContain("showing the latest 500 rows");
  });

  it("shows the empty state", async () => {
    const { text } = await render({ days: 7, truncated: false, rows: [] });
    expect(text).toContain("No usage in the last 7 days");
    expect(host.querySelector("table")).toBeNull();
  });
});
