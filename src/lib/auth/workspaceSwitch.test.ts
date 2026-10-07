// Workspace switch end to end at the unit level (T-0271): POST /api/workspace/active sets the ws cookie, the proxy
// forwards it to the render untouched (also when it refreshes the session and copies cookies onto the response), and
// the request context picks it, on the next page load and on every reload after it.
// T-0353: the render only ever sees the Cookie header the proxy forwarded (x-middleware-request-cookie), never the
// browser jar as a fallback, and the render's cookie parse is Next's own RequestCookies (what next/headers cookies()
// wraps). The refresh-path case feeds the real proxy chunked session cookies shaped like @supabase/ssr 0.12.7
// (package-lock.json) output: <key>.0 and <key>.1 rewritten, <key>.2 removed with an empty value and maxAge 0.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** The Cookie header the render sees (what the proxy forwarded). */
  requestCookie: "",
  headers: {} as Record<string, string>,
  /** What getUser hands the proxy's setAll (a session refresh); null: no refresh, setAll is never called. */
  refreshCookies: null as { name: string; value: string; options: Record<string, unknown> }[] | null,
  setAllCalls: 0,
  signedIn: true,
}));

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";

vi.mock("@/lib/supabase/env", () => ({
  appMode: () => "supabase",
  publicSupabaseEnv: () => ({ url: "http://localhost:54321", anonKey: "anon-placeholder" }),
}));

type CookieAdapter = { setAll(c: { name: string; value: string; options: Record<string, unknown> }[], h?: Record<string, string>): void };

// The proxy's client: getUser may refresh the session through setAll, like @supabase/ssr does.
vi.mock("@supabase/ssr", () => ({
  createServerClient: (_u: string, _k: string, opts: { cookies: CookieAdapter }) => ({
    auth: {
      getUser: async () => {
        if (state.refreshCookies) {
          state.setAllCalls++;
          opts.cookies.setAll(state.refreshCookies, {});
        }
        return { data: { user: state.signedIn ? { id: USER } : null }, error: null };
      },
    },
  }),
}));

const rows = [WS_A, WS_B].map((id, i) => ({ workspace_id: id, role: "owner", created_at: `2026-10-0${i + 1}T00:00:00Z`, workspaces: { name: `WS ${i}` } }));

function fakeQuery(result: unknown) {
  const q: unknown = new Proxy(
    {},
    { get: (_t, prop) => (prop === "then" ? (res: (v: unknown) => unknown) => Promise.resolve(result).then(res) : () => q) },
  );
  return q;
}

// The route handler's and the render's client.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.signedIn ? { id: USER } : null }, error: null }) },
    from: () => fakeQuery({ data: rows, error: null }),
    rpc: async () => ({ data: [], error: null }),
  }),
}));

// cookies() over the real parse: Next builds the render's cookie store from the request Cookie header with
// RequestCookies (next/dist/server/request/cookies.js), so the test does the same with the forwarded header.
vi.mock("next/headers", async () => {
  const { RequestCookies } = await import("next/dist/server/web/spec-extension/cookies");
  return {
    cookies: async () => new RequestCookies(new Headers({ cookie: state.requestCookie })),
    headers: async () => new Headers(state.headers),
  };
});

import { NextRequest } from "next/server";
import { RequestCookies } from "next/dist/server/web/spec-extension/cookies";
import { POST as setActive } from "@/app/api/workspace/active/route";
import { proxy } from "@/proxy";
import { getRequestContext } from "./context";
import { FORWARDED_USER_HEADER } from "./forwardedUser";

/** A browser cookie jar: applies Set-Cookie headers, serialises the Cookie header. */
class Jar {
  private map = new Map<string, string>();
  constructor(init: Record<string, string>) {
    for (const [k, v] of Object.entries(init)) this.map.set(k, v);
  }
  apply(res: Response) {
    for (const line of res.headers.getSetCookie()) {
      const [pair, ...attrs] = line.split(/;\s*/);
      const name = pair.slice(0, pair.indexOf("="));
      const value = decodeURIComponent(pair.slice(pair.indexOf("=") + 1));
      const gone = !value || attrs.some((a) => /^max-age=0$/i.test(a));
      if (gone) this.map.delete(name);
      else this.map.set(name, value);
    }
  }
  get header() {
    return [...this.map].map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join("; ");
  }
  get(name: string) {
    return this.map.get(name);
  }
}

const setCookieNames = (res: Response) => res.headers.getSetCookie().map((l) => l.slice(0, l.indexOf("=")));

/** The Cookie header the proxy forwards to the render. No fallback: a response without it fails here. */
function forwardedCookie(res: Response): string {
  const header = res.headers.get("x-middleware-request-cookie");
  expect(header, "proxy response has no x-middleware-request-cookie").not.toBeNull();
  return header!;
}

/** name=value pairs of a Cookie header: split on "; ", then on the first "=", values URI-decoded. */
function parseCookieHeader(header: string): Map<string, string> {
  const pairs = header
    .split("; ")
    .filter(Boolean)
    .map((kv) => {
      const at = kv.indexOf("=");
      return at === -1 ? ([kv, ""] as const) : ([kv.slice(0, at), decodeURIComponent(kv.slice(at + 1))] as const);
    });
  const map = new Map(pairs);
  expect(map.size, `duplicate cookie names in ${header}`).toBe(pairs.length);
  return map;
}

/** Name and value of every Set-Cookie line. */
const setCookies = (res: Response) =>
  res.headers.getSetCookie().map((l) => {
    const pair = l.split(";")[0]!;
    return { name: pair.slice(0, pair.indexOf("=")), value: decodeURIComponent(pair.slice(pair.indexOf("=") + 1)) };
  });

const SB = "sb-abcdefghijklmnopqrst-auth-token";

/**
 * A page request through the proxy; the render then sees the forwarded Cookie header and user. render: false for a
 * redirect, which never renders and so forwards nothing.
 */
async function loadPage(jar: Jar, path = "/agents", { render = true } = {}) {
  const res = await proxy(new NextRequest(new URL(path, "https://app.test"), { headers: { cookie: jar.header } }));
  state.requestCookie = render ? forwardedCookie(res) : "";
  const fwd = res.headers.get(`x-middleware-request-${FORWARDED_USER_HEADER}`);
  state.headers = fwd ? { [FORWARDED_USER_HEADER]: fwd } : {};
  jar.apply(res);
  return res;
}

async function activeWorkspace(): Promise<string | null> {
  const r = await getRequestContext();
  return r.kind === "ok" ? r.ctx.workspaceId : null;
}

beforeEach(() => {
  state.requestCookie = "";
  state.headers = {};
  state.refreshCookies = null;
  state.setAllCalls = 0;
  state.signedIn = true;
  vi.stubEnv("FORWARDED_USER_SECRET", "test-forwarded-secret");
});

afterEach(() => vi.unstubAllEnvs());

describe("switching the active workspace", () => {
  it("the route sets ws on its response: persistent, httpOnly, path /", async () => {
    state.requestCookie = `ws=${WS_A}`;
    const res = await setActive(new Request("https://app.test/api/workspace/active", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: WS_B }) }));
    expect(res.status).toBe(200);
    const [line] = res.headers.getSetCookie().filter((l) => l.startsWith("ws="));
    expect(line).toContain(`ws=${WS_B}`);
    expect(line).toMatch(/Max-Age=\d+/i);
    expect(line).toMatch(/HttpOnly/i);
    expect(line).toMatch(/Path=\//);
  });

  for (const refresh of [false, true]) {
    it(`takes effect on the next page load and after reload (session refresh in the proxy: ${refresh})`, async () => {
      if (refresh) state.refreshCookies = [{ name: "sb-test-auth-token", value: "refreshed", options: { path: "/" } }];
      const jar = new Jar({ "sb-test-auth-token": "old", ws: WS_A });
      await loadPage(jar);
      expect(await activeWorkspace()).toBe(WS_A);

      state.requestCookie = jar.header;
      const res = await setActive(new Request("https://app.test/api/workspace/active", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: WS_B }) }));
      jar.apply(res);
      expect(jar.get("ws")).toBe(WS_B);

      const page = await loadPage(jar);
      // The proxy forwards ws to the render and never writes or clears it on the response.
      expect(parseCookieHeader(forwardedCookie(page)).get("ws")).toBe(WS_B);
      expect(setCookieNames(page)).not.toContain("ws");
      if (refresh) expect(setCookieNames(page)).toContain("sb-test-auth-token");
      expect(await activeWorkspace()).toBe(WS_B);

      await loadPage(jar);
      expect(jar.get("ws")).toBe(WS_B);
      expect(await activeWorkspace()).toBe(WS_B);
    });
  }

  it("a signed-out redirect to /login leaves ws alone", async () => {
    state.signedIn = false;
    state.refreshCookies = [{ name: "sb-test-auth-token", value: "refreshed", options: { path: "/" } }];
    const jar = new Jar({ "sb-test-auth-token": "old", ws: WS_B });
    const res = await loadPage(jar, "/agents", { render: false });
    expect(res.headers.get("location")).toContain("/login");
    expect(res.headers.get("x-middleware-request-cookie")).toBeNull();
    expect(setCookieNames(res)).not.toContain("ws");
    expect(jar.get("ws")).toBe(WS_B);
  });

  it("the context ignores a ws cookie that is not one of the memberships", async () => {
    const jar = new Jar({ ws: "33333333-3333-4333-8333-333333333333" });
    await loadPage(jar);
    expect(await activeWorkspace()).toBe(WS_A);
  });

  it("refresh path with chunked session cookies: ws stays WS_B, new chunks forwarded, the removed chunk never keeps its old value", async () => {
    const jar = new Jar({ [`${SB}.0`]: "base64-old0", [`${SB}.1`]: "old1", [`${SB}.2`]: "old2", ws: WS_A });
    await loadPage(jar);
    state.requestCookie = jar.header;
    jar.apply(await setActive(new Request("https://app.test/api/workspace/active", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: WS_B }) })));
    expect(jar.get("ws")).toBe(WS_B);

    // @supabase/ssr 0.12.7 setAll shape: the rewritten chunks with the session options, the dropped chunk as a removal.
    const opts = { path: "/", sameSite: "lax", httpOnly: false, maxAge: 34560000 };
    state.refreshCookies = [
      { name: `${SB}.0`, value: "base64-eyJhY2Nlc3NfdG9rZW4iOiJuZXcwIn0=", options: opts },
      { name: `${SB}.1`, value: "new1/+=", options: opts },
      { name: `${SB}.2`, value: "", options: { ...opts, maxAge: 0 } },
    ];
    const page = await loadPage(jar);
    expect(state.setAllCalls).toBe(1);

    const fwd = parseCookieHeader(forwardedCookie(page));
    expect(fwd.get("ws")).toBe(WS_B);
    expect(fwd.get(`${SB}.0`)).toBe("base64-eyJhY2Nlc3NfdG9rZW4iOiJuZXcwIn0=");
    expect(fwd.get(`${SB}.1`)).toBe("new1/+=");
    expect(fwd.has(`${SB}.2`) ? fwd.get(`${SB}.2`) : "").toBe("");

    const set = setCookies(page);
    expect(set.map((c) => c.name)).toEqual(expect.arrayContaining([`${SB}.0`, `${SB}.1`]));
    expect(set.filter((c) => c.name === "ws" && c.value !== WS_B)).toEqual([]);
    expect(await activeWorkspace()).toBe(WS_B);
  });

  it("no-refresh path: setAll is never called and the forwarded Cookie header equals the request's", async () => {
    const jar = new Jar({ [`${SB}.0`]: "base64-a", [`${SB}.1`]: "b", ws: WS_B });
    const sent = jar.header;
    const res = await proxy(new NextRequest(new URL("/agents", "https://app.test"), { headers: { cookie: sent } }));
    expect(state.setAllCalls).toBe(0);
    expect(forwardedCookie(res)).toBe(sent);
    expect(setCookieNames(res)).toEqual([]);
  });
});

describe("render-path cookie parse", () => {
  it("a percent-encoded ws plus chunked sb cookies parse to workspaceId WS_B through the real parse", async () => {
    const encodedWs = WS_B.replace(/-/g, "%2D");
    state.requestCookie = `${SB}.0=base64-eyJhIjoiYiJ9; ${SB}.1=x%2By%3D; ws=${encodedWs}`;
    const parsed = new RequestCookies(new Headers({ cookie: state.requestCookie }));
    expect(parsed.get("ws")?.value).toBe(WS_B);
    expect(parsed.get(`${SB}.1`)?.value).toBe("x+y=");
    expect(await activeWorkspace()).toBe(WS_B);
  });
});
