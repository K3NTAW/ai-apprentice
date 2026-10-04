// Every listed route segment has a loading.tsx that renders a canvas skeleton at once (no data, no await).
import { existsSync } from "node:fs";
import path from "node:path";
import type { ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

// Segment -> whether its page renders AppShell itself (then the skeleton draws the sidebar too).
const SEGMENTS: Record<string, boolean> = {
  agents: true,
  "agents/[id]": true,
  "agents/[id]/studio": true,
  "agents/new": true,
  "processes/[id]": true,
  learn: true,
  workspace: true,
  map: false,
  "map/[id]": false,
  "debrief/[id]": false,
  capture: false,
  teach: false,
};

const modules = import.meta.glob("./**/loading.tsx", { eager: true }) as Record<string, { default: ComponentType }>;

describe("loading.tsx per route segment", () => {
  it.each(Object.entries(SEGMENTS))("%s renders a skeleton", (segment, shell) => {
    expect(existsSync(path.join(process.cwd(), "src/app", segment, "loading.tsx"))).toBe(true);
    const Loading = modules[`./${segment}/loading.tsx`]?.default;
    expect(Loading).toBeTypeOf("function");
    const html = renderToStaticMarkup(<Loading />);
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("animate-pulse");
    expect(html).toMatch(/Loading .+…/);
    expect(html.includes("data-skeleton-shell")).toBe(shell);
  });
});
