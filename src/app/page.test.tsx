import { renderToStaticMarkup } from "react-dom/server";
import { readdirSync, readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "local" as "local" | "supabase" | "misconfigured",
  ctx: { kind: "signed_out" } as { kind: string } | Error,
}));
vi.mock("@/lib/supabase/env", () => ({ appMode: () => state.mode }));
vi.mock("@/lib/auth/context", () => ({
  getRequestContext: async () => {
    if (state.ctx instanceof Error) throw state.ctx;
    return state.ctx;
  },
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`NEXT_REDIRECT ${to}`);
  },
}));

import Home from "./page";

const target = async () => {
  try {
    await Home();
  } catch (e) {
    return String(e).match(/NEXT_REDIRECT (\S+)/)?.[1] ?? String(e);
  }
  return null;
};

beforeEach(() => {
  state.mode = "supabase";
  state.ctx = { kind: "signed_out" };
});

describe("'/' opens the product", () => {
  it("redirects a signed-in user to /agents", async () => {
    state.ctx = { kind: "ok" };
    expect(await target()).toBe("/agents");
  });

  it("redirects a signed-out user to /login", async () => {
    expect(await target()).toBe("/login");
  });

  it("redirects to /agents in local mode (no sign-in there)", async () => {
    state.mode = "local";
    expect(await target()).toBe("/agents");
  });

  it("a user without a workspace still goes to /agents (the gallery handles it)", async () => {
    state.ctx = { kind: "no_workspace" };
    expect(await target()).toBe("/agents");
  });

  it("a misconfigured context (Supabase client could not be built) goes to /login with the setup notice, not /agents", async () => {
    state.ctx = { kind: "misconfigured" };
    expect(await target()).toBe("/login?error=setup");
  });

  it("an error from the context lookup (e.g. Supabase failure) goes to /login with the error notice, not /agents", async () => {
    state.ctx = new Error("supabase down");
    expect(await target()).toBe("/login?error=unavailable");
    state.ctx = { kind: "error" };
    expect(await target()).toBe("/login?error=unavailable");
  });

  it("shows the setup notice in misconfigured mode", async () => {
    state.mode = "misconfigured";
    const html = renderToStaticMarkup(await Home());
    expect(html).toContain("This deployment is not set up yet.");
    expect(html).toContain("docs/DEPLOY.md");
  });

  it("no marketing landing remains in the app", () => {
    expect(readdirSync("src/components/landing").sort()).toEqual(["BrandMark.tsx", "Landing.tsx"]);
    const src = readFileSync("src/components/landing/Landing.tsx", "utf8");
    for (const copy of ["Keep the judgment when the expert retires.", "The Apprentice Test", 'data-screen="landing"']) expect(src).not.toContain(copy);
  });
});
