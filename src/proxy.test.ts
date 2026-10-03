import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { unstable_doesMiddlewareMatch } from "next/experimental/testing/server";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "supabase" as "local" | "supabase" | "misconfigured",
  user: null as { id: string } | null,
  userError: null as unknown,
  getUserThrows: false,
  refresh: false,
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
import { config, proxy } from "./proxy";

const req = (path: string) => new NextRequest(new URL(path, "http://app.test"));

beforeEach(() => {
  state.mode = "supabase";
  state.user = null;
  state.userError = null;
  state.getUserThrows = false;
  state.refresh = false;
  vi.mocked(createServerClient).mockClear();
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
    expect(loginTarget(res)?.next).toBe("/capture");
    const api = await proxy(req("http://app.test/api//session"));
    expect(api.status).toBe(401);
  });

  it("answers /api/* with 401 JSON", async () => {
    for (const p of ["/api/session", "/api/session/x.png", "/api"]) {
      const res = await proxy(req(p));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("passes '/', /login and /auth/callback", async () => {
    for (const p of ["/", "/login", "/login?next=%2Fcapture", "/auth/callback?code=x"]) {
      expect(passes(await proxy(req(p)))).toBe(true);
    }
  });

  it("treats a getUser throw or an error result as signed out", async () => {
    state.getUserThrows = true;
    expect((await proxy(req("/capture"))).status).toBe(307);
    expect((await proxy(req("/api/session"))).status).toBe(401);
    state.getUserThrows = false;
    state.user = { id: "u" };
    state.userError = { message: "auth down" };
    expect((await proxy(req("/capture"))).status).toBe(307);
  });

  it("a redirect and a 401 carry the cookies the client set during refresh", async () => {
    state.refresh = true;
    for (const p of ["/capture", "/api/session"]) {
      const res = await proxy(req(p));
      expect(res.headers.get("set-cookie")).toContain("sb-test-auth-token=refreshed");
      expect(res.headers.get("cache-control")).toContain("no-store");
    }
  });
});

describe("supabase mode, signed in", () => {
  it("passes protected pages and api, with refreshed cookies", async () => {
    state.user = { id: "u" };
    state.refresh = true;
    for (const p of ["/capture", "/api/session"]) {
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
