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
  it("renders the promise and the three steps", () => {
    const html = render();
    expect(html).toContain("captured while they work and taught to the next hire");
    for (const step of ["Capture", "Map", "Teach"]) expect(html).toContain(`. ${step}</h2>`);
    expect(html).toContain("Apprentice Test");
    expect(html).toContain("private workspaces");
  });

  it("says it works on the apps you already use and never mentions the ERP sandbox", async () => {
    const html = render();
    expect(html).toContain("works on the apps you already use");
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
