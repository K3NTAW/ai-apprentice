// Workspace switch end to end at the unit level (T-0271): POST /api/workspace/active sets the ws cookie, the proxy
// forwards it to the render untouched (also when it refreshes the session and copies cookies onto the response), and
// the request context picks it, on the next page load and on every reload after it.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  /** The Cookie header the render sees (what the proxy forwarded). */
  requestCookie: "",
  headers: {} as Record<string, string>,
  refresh: false,
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
        if (state.refresh) opts.cookies.setAll([{ name: "sb-test-auth-token", value: "refreshed", options: { path: "/" } }], {});
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

vi.mock("next/headers", () => ({
  cookies: async () => {
    const jar = new Map(
      state.requestCookie
        .split(/;\s*/)
        .filter(Boolean)
        .map((kv) => [kv.slice(0, kv.indexOf("=")), decodeURIComponent(kv.slice(kv.indexOf("=") + 1))] as const),
    );
    return { get: (name: string) => (jar.has(name) ? { name, value: jar.get(name)! } : undefined), getAll: () => [], set: () => {} };
  },
  headers: async () => new Headers(state.headers),
}));

import { NextRequest } from "next/server";
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

/** A page request through the proxy; the render then sees the forwarded Cookie header and user. */
async function loadPage(jar: Jar, path = "/agents") {
  const res = await proxy(new NextRequest(new URL(path, "https://app.test"), { headers: { cookie: jar.header } }));
  state.requestCookie = res.headers.get("x-middleware-request-cookie") ?? jar.header;
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
  state.refresh = false;
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
      state.refresh = refresh;
      const jar = new Jar({ "sb-test-auth-token": "old", ws: WS_A });
      await loadPage(jar);
      expect(await activeWorkspace()).toBe(WS_A);

      state.requestCookie = jar.header;
      const res = await setActive(new Request("https://app.test/api/workspace/active", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ workspaceId: WS_B }) }));
      jar.apply(res);
      expect(jar.get("ws")).toBe(WS_B);

      const page = await loadPage(jar);
      // The proxy forwards ws to the render and never writes or clears it on the response.
      expect(page.headers.get("x-middleware-request-cookie") ?? jar.header).toContain(`ws=${WS_B}`);
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
    state.refresh = true;
    const jar = new Jar({ "sb-test-auth-token": "old", ws: WS_B });
    const res = await loadPage(jar);
    expect(res.headers.get("location")).toContain("/login");
    expect(setCookieNames(res)).not.toContain("ws");
    expect(jar.get("ws")).toBe(WS_B);
  });

  it("the context ignores a ws cookie that is not one of the memberships", async () => {
    const jar = new Jar({ ws: "33333333-3333-4333-8333-333333333333" });
    await loadPage(jar);
    expect(await activeWorkspace()).toBe(WS_A);
  });
});
