import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ user: null as { id: string } | null }));

vi.mock("@/lib/supabase/env", () => ({
  appMode: () => "supabase",
  publicSupabaseEnv: () => ({ url: "http://localhost:54321", anonKey: "anon-placeholder" }),
}));

type Adapter = { setAll(c: { name: string; value: string; options: Record<string, unknown> }[]): void };

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: vi.fn(() => ({})),
  createServerClient: vi.fn((_u: string, _k: string, opts: { cookies: Adapter }) => ({
    auth: {
      getUser: vi.fn(async () => {
        // The SSR client hands over a refreshed token without a lifetime: the response must still persist it.
        opts.cookies.setAll([{ name: "sb-test-auth-token", value: "refreshed", options: { path: "/" } }]);
        return { data: { user: state.user }, error: null };
      }),
    },
  })),
}));

import { createBrowserClient, createServerClient } from "@supabase/ssr";
import { proxy } from "@/proxy";
import { createSupabaseBrowserClient } from "./browser";
import { persistentCookie, SESSION_COOKIE_MAX_AGE, sessionCookieOptions } from "./cookieOptions";

beforeEach(() => {
  state.user = null;
  vi.mocked(createServerClient).mockClear();
});

describe("persistent session cookies (T-0255)", () => {
  it("the client cookie options carry a max-age of 400 days", () => {
    expect(sessionCookieOptions().maxAge).toBe(SESSION_COOKIE_MAX_AGE);
    expect(SESSION_COOKIE_MAX_AGE).toBe(400 * 24 * 60 * 60);
    expect(sessionCookieOptions().path).toBe("/");
  });

  it("persistentCookie adds a max-age to a session-only cookie and leaves lifetimes and removals alone", () => {
    expect(persistentCookie("v", { path: "/" }).maxAge).toBe(SESSION_COOKIE_MAX_AGE);
    expect(persistentCookie("v").maxAge).toBe(SESSION_COOKIE_MAX_AGE);
    expect(persistentCookie("v", { maxAge: 60 }).maxAge).toBe(60);
    const expires = new Date("2027-01-01T00:00:00Z");
    expect(persistentCookie("v", { expires })).toEqual({ expires });
    expect(persistentCookie("", { maxAge: 0 })).toEqual({ maxAge: 0 });
    expect(persistentCookie("", {}).maxAge).toBeUndefined();
  });

  it("the browser client is created with the persistent cookie options", () => {
    createSupabaseBrowserClient();
    const opts = vi.mocked(createBrowserClient).mock.calls[0][2] as { cookieOptions?: { maxAge?: number } };
    expect(opts.cookieOptions?.maxAge).toBe(SESSION_COOKIE_MAX_AGE);
  });

  it("the proxy client gets the persistent options and a refreshed cookie keeps a max-age on the /login redirect", async () => {
    const res = await proxy(new NextRequest(new URL("/agents", "http://app.test")));
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toContain("/login");
    const opts = vi.mocked(createServerClient).mock.calls[0][2] as { cookieOptions?: { maxAge?: number } };
    expect(opts.cookieOptions?.maxAge).toBe(SESSION_COOKIE_MAX_AGE);
    const set = res.headers.get("set-cookie") ?? "";
    expect(set).toContain("sb-test-auth-token=refreshed");
    expect(set).toMatch(new RegExp(`Max-Age=${SESSION_COOKIE_MAX_AGE}`, "i"));
  });

  it("a signed-in page response carries the refreshed cookie with a max-age too", async () => {
    state.user = { id: "u1" };
    const res = await proxy(new NextRequest(new URL("/agents", "http://app.test")));
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("set-cookie") ?? "").toMatch(new RegExp(`Max-Age=${SESSION_COOKIE_MAX_AGE}`, "i"));
  });
});
