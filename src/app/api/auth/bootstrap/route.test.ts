import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "supabase" as "local" | "supabase" | "misconfigured",
  user: { data: { user: { id: "u", email_confirmed_at: "2026-10-04T05:00:00Z" } }, error: null } as { data: unknown; error: unknown } | "throw",
  members: { data: [], error: null } as { data: unknown; error: unknown },
  rpc: { data: [], error: null } as { data: unknown; error: unknown },
  calls: [] as string[],
}));

vi.mock("@/lib/supabase/env", () => ({
  appMode: () => state.mode,
  publicSupabaseEnv: () => (state.mode === "supabase" ? { url: "http://localhost:54321", anonKey: "anon-placeholder" } : null),
}));

function fakeQuery(result: { data: unknown; error: unknown }) {
  const q: unknown = new Proxy({}, { get: (_t, p) => (p === "then" ? (res: (v: unknown) => unknown) => Promise.resolve(result).then(res) : () => q) });
  return q;
}

// Session cookie stand-in: the server client sees a user only when the request carried one.
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: vi.fn(async () => {
        state.calls.push("getUser");
        if (state.user === "throw") throw new Error("network");
        return state.user;
      }),
      getSession: () => {
        throw new Error("getSession must not be called");
      },
    },
    from: () => fakeQuery(state.members),
    rpc: vi.fn(async (name: string) => {
      state.calls.push(name);
      return state.rpc;
    }),
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));

import { bootstrapThrottle, BOOTSTRAP_MAX_PER_USER, BOOTSTRAP_MAX_UNAUTH_PER_IP, clientIp } from "@/lib/auth/throttle";
import { POST } from "./route";

const WS_OWN = "11111111-1111-4111-8111-111111111111";
const WS_INV = "33333333-3333-4333-8333-333333333333";

const call = (body: unknown = {}, headers: Record<string, string> = {}) =>
  POST(
    new Request("http://app.test/api/auth/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "sb-test-auth-token=session", ...headers },
      body: JSON.stringify(body),
    }),
  );

const signedIn = (id: string, confirmedAt: string | null = "2026-10-04T05:00:00Z") => ({
  data: { user: { id, email_confirmed_at: confirmedAt } },
  error: null,
});
const signedOut = { data: { user: null }, error: { status: 401, message: "Auth session missing!" } };

beforeEach(() => {
  state.mode = "supabase";
  state.user = signedIn("u");
  state.members = { data: [], error: null };
  state.rpc = { data: [{ workspace_id: WS_OWN, name: "Personal", role: "owner" }], error: null };
  state.calls = [];
  bootstrapThrottle.reset();
});

describe("POST /api/auth/bootstrap", () => {
  it("401 without a session, no bootstrap", async () => {
    state.user = signedOut;
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(state.calls).toEqual(["getUser"]);
  });

  it("401 when getUser throws", async () => {
    state.user = "throw";
    expect((await call()).status).toBe(401);
  });

  it("with a session: runs bootstrap_workspace and returns /agents", async () => {
    state.members = { data: [{ workspace_id: WS_OWN, role: "owner", created_at: "2026-01-01", workspaces: { name: "P" } }], error: null };
    const res = await call();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirect: "/agents" });
    expect(state.calls).toEqual(["getUser", "bootstrap_workspace"]);
  });

  it("keeps a safe next, drops an unsafe one", async () => {
    expect(await (await call({ next: "/teach" })).json()).toEqual({ redirect: "/teach" });
    expect(await (await call({ next: "//evil.example" })).json()).toEqual({ redirect: "/agents" });
  });

  it("sets the ws cookie for a newly accepted invite", async () => {
    state.members = { data: [{ workspace_id: WS_OWN, role: "owner", created_at: "2026-01-01", workspaces: { name: "P" } }], error: null };
    state.rpc = {
      data: [
        { workspace_id: WS_OWN, name: "P", role: "owner" },
        { workspace_id: WS_INV, name: "Team", role: "learner" },
      ],
      error: null,
    };
    const res = await call();
    expect(res.headers.get("set-cookie") ?? "").toContain(`ws=${WS_INV}`);
  });

  it("500 when the bootstrap fails", async () => {
    state.members = { data: [{ workspace_id: WS_OWN, role: "owner", created_at: "2026-01-01", workspaces: { name: "P" } }], error: null };
    state.rpc = { data: null, error: { message: "boom" } };
    const res = await call();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "workspace_setup_failed" });
  });

  it("403 email_not_confirmed for a session without a confirmed email, no bootstrap", async () => {
    state.members = { data: [{ workspace_id: WS_OWN, role: "owner", created_at: "2026-01-01", workspaces: { name: "P" } }], error: null };
    state.user = signedIn("u", null);
    const res = await call();
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "email_not_confirmed" });
    expect(state.calls).toEqual(["getUser"]);
  });

  it("authenticated attempts are throttled per user id, whatever the IP", async () => {
    state.members = { data: [{ workspace_id: WS_OWN, role: "owner", created_at: "2026-01-01", workspaces: { name: "P" } }], error: null };
    for (let i = 0; i < BOOTSTRAP_MAX_PER_USER; i++) {
      expect((await call({}, { "x-vercel-forwarded-for": `203.0.113.${i}` })).status).toBe(200);
    }
    const blocked = await call({}, { "x-vercel-forwarded-for": "198.51.100.2" });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    state.user = signedIn("other");
    expect((await call({}, { "x-vercel-forwarded-for": "198.51.100.2" })).status).toBe(200);
  });

  it("requireContext runs before the throttle; unauthenticated 401s use a separate, looser per-IP limit", async () => {
    state.user = signedOut;
    for (let i = 0; i < BOOTSTRAP_MAX_UNAUTH_PER_IP; i++) expect((await call({}, { "x-vercel-forwarded-for": "203.0.113.7" })).status).toBe(401);
    expect(state.calls.filter((c) => c === "getUser")).toHaveLength(BOOTSTRAP_MAX_UNAUTH_PER_IP);
    const blocked = await call({}, { "x-vercel-forwarded-for": "203.0.113.7" });
    expect(blocked.status).toBe(429);
    expect((await call({}, { "x-vercel-forwarded-for": "198.51.100.2" })).status).toBe(401);
    // The IP's 401 budget does not touch a signed-in user behind the same IP.
    state.user = signedIn("u");
    expect((await call({}, { "x-vercel-forwarded-for": "203.0.113.7" })).status).toBe(200);
  });

  it("client IP prefers the Vercel platform header over a client-sent x-forwarded-for", () => {
    const h = (o: Record<string, string>) => clientIp(new Headers(o));
    expect(h({ "x-vercel-forwarded-for": "203.0.113.7", "x-forwarded-for": "6.6.6.6" })).toBe("203.0.113.7");
    expect(h({ "x-real-ip": "203.0.113.8", "x-forwarded-for": "6.6.6.6" })).toBe("203.0.113.8");
    expect(h({ "x-forwarded-for": "198.51.100.2, 10.0.0.1" })).toBe("198.51.100.2");
    expect(h({})).toBe("unknown");
  });

  it("400 for a non-JSON body, 503 when Supabase is not configured", async () => {
    const form = await POST(
      new Request("http://app.test/api/auth/bootstrap", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }),
    );
    expect(form.status).toBe(400);
    state.mode = "misconfigured";
    expect((await call()).status).toBe(503);
  });
});
