import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "supabase" as "local" | "supabase" | "misconfigured",
  exchange: { data: { user: { id: "u" } }, error: null } as { data: unknown; error: unknown } | "throw",
  members: { data: [], error: null } as { data: unknown; error: unknown },
  rpc: { data: [], error: null } as { data: unknown; error: unknown },
  calls: [] as [string, unknown[]][],
}));

vi.mock("@/lib/supabase/env", () => ({
  appMode: () => state.mode,
  publicSupabaseEnv: () => (state.mode === "supabase" ? { url: "http://localhost:54321", anonKey: "anon-placeholder" } : null),
}));

function fakeQuery(result: { data: unknown; error: unknown }) {
  const q: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown) => Promise.resolve(result).then(res);
        return (...args: unknown[]) => {
          state.calls.push([String(prop), args]);
          return q;
        };
      },
    },
  );
  return q;
}

type CookieAdapter = { setAll(c: { name: string; value: string; options: Record<string, unknown> }[], h?: Record<string, string>): void };

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_u: string, _k: string, opts: { cookies: CookieAdapter }) => ({
    auth: {
      exchangeCodeForSession: vi.fn(async (code: string) => {
        state.calls.push(["exchangeCodeForSession", [code]]);
        if (state.exchange === "throw") throw new Error("network");
        if (!state.exchange.error) {
          opts.cookies.setAll([{ name: "sb-test-auth-token", value: "session", options: { path: "/", httpOnly: true } }], {
            "Cache-Control": "private, no-store",
          });
        }
        return state.exchange;
      }),
      getSession: () => {
        throw new Error("getSession must not be called");
      },
    },
    from: (table: string) => {
      state.calls.push(["from", [table]]);
      return fakeQuery(state.members);
    },
    rpc: vi.fn(async (name: string) => {
      state.calls.push(["rpc", [name]]);
      return state.rpc;
    }),
  })),
}));

import { createServerClient } from "@supabase/ssr";
import { GET } from "./route";

const WS_OWN = "11111111-1111-4111-8111-111111111111";
const WS_INV1 = "33333333-3333-4333-8333-333333333333";
const WS_INV2 = "22222222-2222-4222-8222-222222222222";

const call = (qs: string) => GET(new NextRequest(`http://app.test/auth/callback${qs}`));
const location = (res: Response) => {
  const u = new URL(res.headers.get("location") ?? "");
  return { origin: u.origin, path: u.pathname + u.search };
};
const setCookie = (res: Response) => res.headers.get("set-cookie") ?? "";

beforeEach(() => {
  state.mode = "supabase";
  state.exchange = { data: { user: { id: "u" } }, error: null };
  state.members = { data: [], error: null };
  state.rpc = { data: [{ workspace_id: WS_OWN, name: "Personal", role: "owner" }], error: null };
  state.calls = [];
  vi.mocked(createServerClient).mockClear();
});

describe("GET /auth/callback, sign-up confirmation (flow=signup)", () => {
  it("opened outside the app (exchange fails, no PKCE verifier): lands on /auth/confirmed, no bootstrap", async () => {
    state.exchange = { data: { user: null, session: null }, error: { status: 400, code: "bad_code_verifier" } };
    expect(location(await call("?code=abc&flow=signup&next=%2Fagents")).path).toBe("/auth/confirmed");
    expect(state.calls.some(([n]) => n === "rpc")).toBe(false);
  });

  it("opened in the browser that signed up: session, bootstrap, then the safe next", async () => {
    state.members = { data: [{ workspace_id: WS_OWN, role: "owner", created_at: "2026-01-01", workspaces: { name: "P" } }], error: null };
    expect(location(await call("?code=abc&flow=signup&next=%2Fagents")).path).toBe("/agents");
  });

  it("without flow=signup a failed exchange is still link_invalid", async () => {
    state.exchange = { data: { user: null, session: null }, error: { status: 400 } };
    expect(location(await call("?code=abc")).path).toBe("/login?error=link_invalid");
  });
});

describe("GET /auth/callback", () => {
  it("local mode redirects to /dashboard without Supabase", async () => {
    state.mode = "local";
    expect(location(await call("?code=abc&next=/teach")).path).toBe("/dashboard");
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("misconfigured -> /login?error=workspace_setup_failed", async () => {
    state.mode = "misconfigured";
    expect(location(await call("?code=abc")).path).toBe("/login?error=workspace_setup_failed");
  });

  it("missing code -> /login?error=missing_code", async () => {
    const res = await call("?next=/teach");
    expect(location(res)).toEqual({ origin: "http://app.test", path: "/login?error=missing_code" });
  });

  it("exchange error or throw -> /login?error=link_invalid", async () => {
    state.exchange = { data: { user: null }, error: { message: "bad code" } };
    expect(location(await call("?code=abc&next=/teach")).path).toBe("/login?error=link_invalid");
    state.exchange = "throw";
    expect(location(await call("?code=abc&next=/teach")).path).toBe("/login?error=link_invalid");
  });

  it("bootstrap error -> workspace_setup_failed, never next", async () => {
    state.rpc = { data: null, error: { message: "boom" } };
    const res = await call("?code=abc&next=/teach");
    expect(location(res).path).toBe("/login?error=workspace_setup_failed");
  });

  it("bootstrap with zero rows -> workspace_setup_failed", async () => {
    state.rpc = { data: [], error: null };
    expect(location(await call("?code=abc&next=/teach")).path).toBe("/login?error=workspace_setup_failed");
  });

  it("membership read error -> workspace_setup_failed without calling the rpc", async () => {
    state.members = { data: null, error: { message: "boom" } };
    expect(location(await call("?code=abc&next=/teach")).path).toBe("/login?error=workspace_setup_failed");
    expect(state.calls.some(([m]) => m === "rpc")).toBe(false);
  });

  it("success redirects to safeNext(next) on the request origin with session cookies", async () => {
    const res = await call(`?code=abc&next=${encodeURIComponent("/teach?x=1")}`);
    expect(location(res)).toEqual({ origin: "http://app.test", path: "/teach?x=1" });
    expect(state.calls).toContainEqual(["exchangeCodeForSession", ["abc"]]);
    expect(state.calls).toContainEqual(["rpc", ["bootstrap_workspace"]]);
    expect(setCookie(res)).toContain("sb-test-auth-token=session");
  });

  it("an unsafe next goes to /dashboard", async () => {
    for (const next of ["//evil.com", "https://evil.com", "/login", "/auth/callback"]) {
      expect(location(await call(`?code=abc&next=${encodeURIComponent(next)}`)).path).toBe("/dashboard");
    }
    expect(location(await call("?code=abc")).path).toBe("/dashboard");
  });

  it("sets ws to the lowest new workspace when bootstrap adds memberships", async () => {
    state.members = {
      data: [{ workspace_id: WS_OWN, role: "owner", created_at: "2026-10-03T00:00:00Z", workspaces: { name: "Personal" } }],
      error: null,
    };
    state.rpc = {
      data: [
        { workspace_id: WS_OWN, name: "Personal", role: "owner" },
        { workspace_id: WS_INV1, name: "Inviter 1", role: "learner" },
        { workspace_id: WS_INV2, name: "Inviter 2", role: "learner" },
      ],
      error: null,
    };
    const res = await call("?code=abc&next=/teach");
    expect(location(res).path).toBe("/teach");
    const cookies = setCookie(res);
    expect(cookies).toContain(`ws=${WS_INV2}`);
    expect(cookies).toContain("sb-test-auth-token=session");
    expect(cookies.toLowerCase()).toContain("httponly");
  });

  it("does not set ws when bootstrap adds nothing new", async () => {
    state.members = {
      data: [{ workspace_id: WS_OWN, role: "owner", created_at: "2026-10-03T00:00:00Z", workspaces: { name: "Personal" } }],
      error: null,
    };
    const res = await call("?code=abc&next=/teach");
    expect(setCookie(res)).not.toContain("ws=");
  });

  it("a first login (no prior memberships) sets ws to the bootstrapped workspace", async () => {
    const res = await call("?code=abc");
    expect(setCookie(res)).toContain(`ws=${WS_OWN}`);
  });
});
