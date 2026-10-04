import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "supabase" as "local" | "supabase" | "misconfigured",
  user: { data: { user: { id: "u" } }, error: null } as { data: unknown; error: unknown } | "throw",
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

import { bootstrapThrottle, BOOTSTRAP_MAX_PER_IP } from "@/lib/auth/throttle";
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

beforeEach(() => {
  state.mode = "supabase";
  state.user = { data: { user: { id: "u" } }, error: null };
  state.members = { data: [], error: null };
  state.rpc = { data: [{ workspace_id: WS_OWN, name: "Personal", role: "owner" }], error: null };
  state.calls = [];
  bootstrapThrottle.reset();
});

describe("POST /api/auth/bootstrap", () => {
  it("401 without a session, no bootstrap", async () => {
    state.user = { data: { user: null }, error: { status: 401, message: "Auth session missing!" } };
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

  it("throttled per IP", async () => {
    for (let i = 0; i < BOOTSTRAP_MAX_PER_IP; i++) expect((await call({}, { "x-forwarded-for": "203.0.113.7" })).status).toBe(200);
    const blocked = await call({}, { "x-forwarded-for": "203.0.113.7" });
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: "rate_limited" });
    expect((await call({}, { "x-forwarded-for": "198.51.100.2" })).status).toBe(200);
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
