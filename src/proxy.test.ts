import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "supabase" as "local" | "supabase" | "misconfigured",
  user: null as { id: string } | null,
  userError: null as unknown,
  getUserThrows: false,
  refresh: false,
  getUserCalls: 0,
}));

vi.mock("@/lib/supabase/env", () => ({
  appMode: () => state.mode,
  publicSupabaseEnv: () => (state.mode === "supabase" ? { url: "http://localhost:54321", anonKey: "anon-placeholder" } : null),
}));

type CookieAdapter = {
  getAll(): unknown;
  setAll(c: { name: string; value: string; options: Record<string, unknown> }[], h?: Record<string, string>): void;
};

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_url: string, _key: string, opts: { cookies: CookieAdapter }) => ({
    auth: {
      getUser: vi.fn(async () => {
        state.getUserCalls++;
        if (state.refresh) {
          opts.cookies.setAll([{ name: "sb-test-auth-token", value: "refreshed", options: { path: "/", httpOnly: true } }], {
            "Cache-Control": "private, no-cache, no-store, must-revalidate, max-age=0",
          });
        }
        if (state.getUserThrows) throw new Error("network");
        return { data: { user: state.user }, error: state.userError };
      }),
      getSession: vi.fn(() => {
        throw new Error("getSession must not be called");
      }),
    },
  })),
}));

import { createServerClient } from "@supabase/ssr";
import { FORWARDED_USER_HEADER, verifyForwardedUser } from "@/lib/auth/forwardedUser";
import { config, proxy } from "./proxy";

const req = (path: string) => new NextRequest(new URL(path, "http://app.test"));

beforeEach(() => {
  state.mode = "supabase";
  state.user = null;
  state.userError = null;
  state.getUserThrows = false;
  state.refresh = false;
  state.getUserCalls = 0;
  vi.mocked(createServerClient).mockClear();
  vi.stubEnv("FORWARDED_USER_SECRET", "test-forwarded-secret");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";
const loginTarget = (res: Response) => {
  const loc = res.headers.get("location");
  if (!loc) return null;
  const u = new URL(loc);
  return { path: u.pathname, next: u.searchParams.get("next"), origin: u.origin };
};

describe("files", () => {
  it("src/proxy.ts exists and src/middleware.ts does not", () => {
    expect(existsSync(fileURLToPath(new URL("./proxy.ts", import.meta.url)))).toBe(true);
    expect(existsSync(fileURLToPath(new URL("./middleware.ts", import.meta.url)))).toBe(false);
  });
});

describe("local mode", () => {
  it("passes every path without touching Supabase", async () => {
    state.mode = "local";
    for (const p of ["/", "/capture", "/api/session", "/login", "/whatever?x=1"]) {
      expect(passes(await proxy(req(p)))).toBe(true);
    }
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe("supabase mode, signed out", () => {
  it("redirects protected pages to /login?next=<encoded path+search>", async () => {
    for (const p of ["/capture", "/mapx", "/some-new-page", "/teach?x=1&y=2", "/loginx", "/authors"]) {
      const res = await proxy(req(p));
      expect(res.status).toBe(307);
      expect(loginTarget(res)).toEqual({ path: "/login", next: p, origin: "http://app.test" });
      expect(res.headers.get("location")).toContain(`next=${encodeURIComponent(p)}`);
    }
  });

  it("treats empty segments as protected: //capture redirects, /api//session is 401", async () => {
    const res = await proxy(req("http://app.test//capture"));
    expect(res.status).toBe(307);
    expect(loginTarget(res)?.path).toBe("/login");
    expect(loginTarget(res)?.next).toBe("/dashboard");
  });

  it("passes /api/* without an Auth round trip: route handlers answer 401 themselves (requireContext)", async () => {
    for (const p of ["/api/session", "/api/session/x.png", "/api", "/api//session"]) {
      expect(passes(await proxy(req(p))), p).toBe(true);
    }
    expect(state.getUserCalls).toBe(0);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("passes '/', /login and /auth/callback", async () => {
    for (const p of ["/", "/login", "/login?next=%2Fcapture", "/auth/callback?code=x"]) {
      expect(passes(await proxy(req(p)))).toBe(true);
    }
  });

  it("treats a getUser throw or an error result as signed out", async () => {
    state.getUserThrows = true;
    expect((await proxy(req("/capture"))).status).toBe(307);
    state.getUserThrows = false;
    state.user = { id: "u" };
    state.userError = { message: "auth down" };
    expect((await proxy(req("/capture"))).status).toBe(307);
  });

  it("a redirect carries the cookies the client set during refresh", async () => {
    state.refresh = true;
    for (const p of ["/capture"]) {
      const res = await proxy(req(p));
      expect(res.headers.get("set-cookie")).toContain("sb-test-auth-token=refreshed");
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
  });
});

describe("supabase mode, signed in", () => {
  it("passes protected pages with refreshed cookies", async () => {
    state.user = { id: "u" };
    state.refresh = true;
    for (const p of ["/capture", "/agents"]) {
      const res = await proxy(req(p));
      expect(passes(res)).toBe(true);
      expect(res.headers.get("set-cookie")).toContain("sb-test-auth-token=refreshed");
    }
  });
});

describe("misconfigured mode", () => {
  beforeEach(() => {
    state.mode = "misconfigured";
  });
  it("answers 503 for protected pages and api", async () => {
    const page = await proxy(req("/capture"));
    expect(page.status).toBe(503);
    expect(page.headers.get("content-type")).toContain("text/plain");
    const api = await proxy(req("/api/session"));
    expect(api.status).toBe(503);
    expect(await api.json()).toEqual({ error: "supabase_not_configured" });
  });
  it("passes public paths", async () => {
    for (const p of ["/", "/login", "/auth/callback"]) expect(passes(await proxy(req(p)))).toBe(true);
    expect(createServerClient).not.toHaveBeenCalled();
  });
});

describe("matcher", () => {
  const matches = (url: string) => unstable_doesMiddlewareMatch({ config, url });
  it("gates pages and every /api path, static extension or not", () => {
    for (const p of ["/", "/capture", "/login", "/api/session", "/api/session/x.png", "/api"]) {
      expect(matches(p), p).toBe(true);
    }
  });
  it("skips Next internals and static assets outside /api", () => {
    for (const p of ["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/logo.png", "/fonts/a.woff2"]) {
      expect(matches(p), p).toBe(false);
    }
  });
});

describe("auth round trips (performance 2)", () => {
  const withHeaders = (path: string, headers: Record<string, string>) =>
    new NextRequest(new URL(path, "http://app.test"), { headers });
  const forwarded = (res: Response) => res.headers.get(`x-middleware-request-${FORWARDED_USER_HEADER}`);

  const prefetches: Record<string, string>[] = [
    { "next-router-prefetch": "1", rsc: "1" },
    { "next-router-prefetch": "1" },
    { purpose: "prefetch" },
    { "sec-purpose": "prefetch;prerender" },
    { "sec-purpose": "prefetch" },
    { "x-middleware-prefetch": "1" },
  ];

  it("a page request with any prefetch header and no session is redirected to /login", async () => {
    for (const h of prefetches) {
      const res = await proxy(withHeaders("/agents", h));
      expect(res.status, JSON.stringify(h)).toBe(307);
      expect(loginTarget(res)?.path, JSON.stringify(h)).toBe("/login");
      expect(forwarded(res), JSON.stringify(h)).toBeNull();
    }
    expect(state.getUserCalls).toBe(prefetches.length);
  });

  it("a signed-in prefetch costs one getUser (the session refresh) and forwards the user", async () => {
    state.user = { id: "u" };
    for (const h of prefetches) {
      const res = await proxy(withHeaders("/agents", h));
      expect(passes(res), JSON.stringify(h)).toBe(true);
      expect(verifyForwardedUser(forwarded(res))?.id).toBe("u");
    }
    expect(state.getUserCalls).toBe(prefetches.length);
  });

  it("paths outside /_next/ ending in .js, .css, .txt and similar stay protected", async () => {
    for (const p of ["/app-route.js", "/agents/x.css", "/robots-private.txt", "/capture/a.map", "/teach/b.xml", "/a.png"]) {
      const res = await proxy(req(p));
      expect(res.status, p).toBe(307);
      expect(loginTarget(res)?.path, p).toBe("/login");
    }
  });

  it("/_next/ assets skip the Auth call", async () => {
    for (const p of ["/_next/static/chunk.js", "/_next/data/x.json"]) expect(passes(await proxy(req(p))), p).toBe(true);
    expect(state.getUserCalls).toBe(0);
  });

  it("getUser calls in the proxy per request: page 1, prefetch 1, /api 0, /_next 0", async () => {
    state.user = { id: "u" };
    const count = async (r: NextRequest) => {
      state.getUserCalls = 0;
      await proxy(r);
      return state.getUserCalls;
    };
    expect(await count(req("/agents"))).toBe(1);
    expect(await count(withHeaders("/agents", { "next-router-prefetch": "1", rsc: "1" }))).toBe(1);
    expect(await count(req("/api/session"))).toBe(0);
    expect(await count(req("/_next/static/a.js"))).toBe(0);
  });

  it("no getUser for /api/*, signed in or not", async () => {
    state.user = { id: "u" };
    for (const p of ["/api/session", "/api/agents", "/api/workspace/active"]) await proxy(req(p));
    expect(state.getUserCalls).toBe(0);
  });

  it("a page request refreshes the session once and forwards the verified user", async () => {
    state.user = { id: "u1" };
    const res = await proxy(withHeaders("/agents", { rsc: "1" }));
    expect(passes(res)).toBe(true);
    expect(state.getUserCalls).toBe(1);
    expect(verifyForwardedUser(forwarded(res))?.id).toBe("u1");
  });

  it("Server-Timing on page responses lists ctx-auth, db and total (signed in and redirected)", async () => {
    const names = (res: Response) =>
      (res.headers.get("server-timing") ?? "").split(",").map((e) => e.trim().split(";")[0]);
    state.user = { id: "u1" };
    expect(names(await proxy(req("/agents")))).toEqual(["ctx-auth", "db", "total"]);
    state.user = null;
    const out = await proxy(req("/agents"));
    expect(out.status).toBe(307);
    expect(names(out)).toEqual(["ctx-auth", "db", "total"]);
    expect(out.headers.get("server-timing")).toMatch(/^ctx-auth;dur=\d+\.\d, db;dur=0\.0, total;dur=\d+\.\d$/);
  });

  it("strips a client-sent forwarded-user header on every path", async () => {
    const forged = "eyJpZCI6ImF0dGFja2VyIn0.forged";
    // Signed out page: redirected, nothing forwarded.
    const page = await proxy(withHeaders("/agents", { [FORWARDED_USER_HEADER]: forged }));
    expect(page.status).toBe(307);
    for (const p of ["/api/session", "/", "/login"]) {
      const res = await proxy(withHeaders(p, { [FORWARDED_USER_HEADER]: forged }));
      expect(passes(res), p).toBe(true);
      expect(forwarded(res), p).toBeNull();
      expect(res.headers.get("x-middleware-override-headers") ?? "", p).not.toContain(FORWARDED_USER_HEADER);
    }
    const prefetch = await proxy(withHeaders("/agents", { [FORWARDED_USER_HEADER]: forged, "next-router-prefetch": "1" }));
    expect(forwarded(prefetch)).toBeNull();
    state.mode = "local";
    expect(forwarded(await proxy(withHeaders("/agents", { [FORWARDED_USER_HEADER]: forged })))).toBeNull();
  });

  it("signed in: the forwarded header is the proxy's own, never the client's", async () => {
    state.user = { id: "u1" };
    const res = await proxy(withHeaders("/agents", { [FORWARDED_USER_HEADER]: "x.y" }));
    expect(verifyForwardedUser(forwarded(res))?.id).toBe("u1");
    expect(verifyForwardedUser("x.y")).toBeNull();
  });
});
