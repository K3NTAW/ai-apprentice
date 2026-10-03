import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "supabase" as "local" | "supabase" | "misconfigured",
  verify: { data: { user: { id: "u" } }, error: null } as { data: unknown; error: unknown } | "throw",
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
        return () => q;
      },
    },
  );
  return q;
}

type CookieAdapter = { setAll(c: { name: string; value: string; options: Record<string, unknown> }[], h?: Record<string, string>): void };

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn((_u: string, _k: string, opts: { cookies: CookieAdapter }) => ({
    auth: {
      verifyOtp: vi.fn(async (args: unknown) => {
        state.calls.push(["verifyOtp", [args]]);
        if (state.verify === "throw") throw new Error("network");
        if (!state.verify.error) {
          opts.cookies.setAll([{ name: "sb-test-auth-token", value: "session", options: { path: "/", httpOnly: true } }]);
        }
        return state.verify;
      }),
    },
    from: () => fakeQuery(state.members),
    rpc: vi.fn(async (name: string) => {
      state.calls.push(["rpc", [name]]);
      return state.rpc;
    }),
  })),
}));

import { createServerClient } from "@supabase/ssr";
import { POST } from "./route";

const WS_OWN = "11111111-1111-4111-8111-111111111111";
const WS_INV = "33333333-3333-4333-8333-333333333333";

const call = (body: unknown, contentType = "application/json") =>
  POST(
    new NextRequest("http://app.test/auth/verify", {
      method: "POST",
      headers: { "content-type": contentType },
      body: typeof body === "string" ? body : JSON.stringify(body),
    }),
  );
const ok = { email: "sabine@example.com", token: "123456" };

beforeEach(() => {
  state.mode = "supabase";
  state.verify = { data: { user: { id: "u" } }, error: null };
  state.members = { data: [], error: null };
  state.rpc = { data: [{ workspace_id: WS_OWN, name: "Personal", role: "owner" }], error: null };
  state.calls = [];
  vi.mocked(createServerClient).mockClear();
});

describe("POST /auth/verify", () => {
  it("verifies the code (type email), bootstraps and answers /agents with the session cookie", async () => {
    const res = await call(ok);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ redirect: "/agents" });
    expect(state.calls).toEqual([
      ["verifyOtp", [{ email: "sabine@example.com", token: "123456", type: "email" }]],
      ["rpc", ["bootstrap_workspace"]],
    ]);
    expect(res.headers.get("set-cookie")).toContain("sb-test-auth-token=session");
  });

  it("honours a safe next and drops an unsafe one", async () => {
    expect(await (await call({ ...ok, next: "/teach?agent=a" })).json()).toEqual({ redirect: "/teach?agent=a" });
    expect(await (await call({ ...ok, next: "//evil.example" })).json()).toEqual({ redirect: "/agents" });
  });

  it("an accepted invite sets the ws cookie to the new workspace", async () => {
    state.members = { data: [{ workspace_id: WS_OWN, role: "owner", workspaces: { name: "Personal" } }], error: null };
    state.rpc = {
      data: [
        { workspace_id: WS_OWN, name: "Personal", role: "owner" },
        { workspace_id: WS_INV, name: "Acme", role: "expert" },
      ],
      error: null,
    };
    expect((await call(ok)).headers.get("set-cookie")).toContain(`ws=${WS_INV}`);
  });

  it("invalid, expired and rate-limited codes map to fixed error codes; nothing is bootstrapped", async () => {
    state.verify = { data: { user: null }, error: { status: 403, code: "otp_expired" } };
    let res = await call(ok);
    expect([res.status, await res.json()]).toEqual([403, { error: "code_expired" }]);
    state.verify = { data: { user: null }, error: { status: 429, code: "over_request_rate_limit" } };
    res = await call(ok);
    expect([res.status, await res.json()]).toEqual([429, { error: "rate_limited" }]);
    state.verify = { data: { user: null }, error: { status: 400, code: "validation_failed" } };
    expect(await (await call(ok)).json()).toEqual({ error: "code_invalid" });
    state.verify = "throw";
    expect(await (await call(ok)).json()).toEqual({ error: "code_invalid" });
    expect(state.calls.some(([n]) => n === "rpc")).toBe(false);
  });

  it("bootstrap error fails visibly with workspace_setup_failed", async () => {
    state.rpc = { data: null, error: { message: "boom" } };
    const res = await call(ok);
    expect([res.status, await res.json()]).toEqual([500, { error: "workspace_setup_failed" }]);
    state.rpc = { data: [{ workspace_id: WS_OWN, name: "Personal", role: "owner" }], error: null };
    state.members = { data: null, error: { message: "read failed" } };
    expect(await (await call(ok)).json()).toEqual({ error: "workspace_setup_failed" });
  });

  it("rejects malformed input, non-JSON posts and a missing configuration before Supabase", async () => {
    expect((await call({ ...ok, token: "12ab56" })).status).toBe(400);
    expect((await call({ ...ok, email: "" })).status).toBe(400);
    expect((await call("{", "application/json")).status).toBe(400);
    expect((await call(ok, "text/plain")).status).toBe(400);
    state.mode = "misconfigured";
    expect((await call(ok)).status).toBe(503);
    expect(createServerClient).not.toHaveBeenCalled();
  });

  it("accepts the longer codes Supabase can be configured for (up to 10 digits)", async () => {
    expect((await call({ ...ok, token: "1234567890" })).status).toBe(200);
    expect((await call({ ...ok, token: "12345678901" })).status).toBe(400);
  });
});
