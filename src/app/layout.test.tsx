// The ?theme= override script exists for local screenshots only; supabase (production) mode renders without it.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ mode: "local" }));
vi.mock("@/lib/supabase/env", () => ({ appMode: () => state.mode }));
vi.mock("next/server", () => ({ connection: async () => {} }));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "font-serif" }) }));
vi.mock("geist/font/sans", () => ({ GeistSans: { variable: "font-sans" } }));
vi.mock("geist/font/mono", () => ({ GeistMono: { variable: "font-mono" } }));

import RootLayout from "./layout";

const render = async (mode: string) => {
  state.mode = mode;
  return renderToStaticMarkup(await RootLayout({ children: <p>page</p> }));
};

describe("root layout theme override", () => {
  it("local mode injects the ?theme= script", async () => {
    const html = await render("local");
    expect(html).toContain("<script>");
    expect(html).toContain('get("theme")');
  });

  it.each(["supabase", "misconfigured"])("%s mode renders without the script", async (mode) => {
    const html = await render(mode);
    expect(html).not.toContain("<script");
    expect(html).not.toContain('get("theme")');
    expect(html).toContain("<p>page</p>");
  });
});
