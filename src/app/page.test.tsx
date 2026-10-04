import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ mode: "local" as "local" | "supabase" | "misconfigured" }));
vi.mock("@/lib/supabase/env", () => ({ appMode: () => state.mode }));

import Home from "./page";

const render = () => renderToStaticMarkup(<Home />);

beforeEach(() => {
  state.mode = "local";
});

describe("landing page", () => {
  it("renders the Main.dc.html promise, the three steps, the Apprentice Test and trust", () => {
    const html = render();
    expect(html).toContain("Keep the judgment when the expert retires.");
    expect(html).toContain("For teams whose experts are about to retire");
    expect(html).toContain("Train, Map, Teach.");
    for (const step of ["Train", "Map", "Teach"]) expect(html).toContain(`>${step}</h3>`);
    expect(html).toContain("Five questions any good apprentice has to answer.");
    for (const q of ["When to ask", "What to ask", "When it has understood", "Whether the new hire learned", "Trust"]) expect(html).toContain(`>${q}</h3>`);
    expect(html).toContain("Off the record, whenever you say it.");
    expect(html).toContain("Built in Zug, Switzerland");
    expect(html).toContain('data-screen="landing"');
  });

  it("says it runs next to the apps you already use and never mentions the ERP sandbox", async () => {
    const html = render();
    expect(html).toContain("Runs next to Outlook, Excel, PowerPoint and any browser tab. Nothing to integrate.");
    expect(html).not.toMatch(/ERP|sandbox/i);
    const { default: ShellHeader } = await import("@/components/shell/ShellHeader");
    const nav = renderToStaticMarkup(<ShellHeader user={null} />);
    expect(nav).not.toMatch(/ERP|\/erp/);
  });

  it("CTA reads 'Sign in' in supabase mode", () => {
    state.mode = "supabase";
    const html = render();
    expect(html).toMatch(/href="\/login"[^>]*>Sign in</);
    expect(html).not.toContain("Open the app");
  });

  it("CTA reads 'Open the app' in local mode", () => {
    const html = render();
    expect(html).toMatch(/href="\/capture"[^>]*>Open the app</);
    expect(html).not.toContain("Sign in");
  });

  it("shows the setup notice in misconfigured mode", () => {
    state.mode = "misconfigured";
    const html = render();
    expect(html).toContain("This deployment is not set up yet.");
    expect(html).toContain("docs/DEPLOY.md");
    expect(html).not.toContain("Open the app");
    expect(html).not.toContain("Sign in");
  });
});
