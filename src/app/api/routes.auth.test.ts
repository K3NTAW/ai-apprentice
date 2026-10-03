// Every route module under src/app/api answers 401 signed out, 503 misconfigured and 403 without a workspace.
// The boundaries (env mode, the Supabase server client, next/headers) are mocked, as in workspace/workspace.test.ts,
// so getRequestContext and requireContext run for real.
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "supabase" as "local" | "supabase" | "misconfigured",
  user: null as { id: string; email: string } | null,
  membershipError: false,
  calls: [] as string[],
}));

function chain(result: unknown) {
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

vi.mock("@/lib/supabase/env", () => ({ appMode: () => state.mode }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.user }, error: null }) },
    from: (table: string) => {
      state.calls.push(`from:${table}`);
      return chain(state.membershipError ? { data: null, error: { message: "boom" } } : { data: [], error: null });
    },
    rpc: async () => ({ data: null, error: { message: "boom" } }),
    storage: { from: () => state.calls.push("storage") },
  }),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const describeFrame = vi.hoisted(() => vi.fn());
vi.mock("@/lib/perception/vision", () => ({ describeFrame }));

const modules = import.meta.glob("./**/route.ts", { eager: true }) as Record<string, Record<string, unknown>>;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;

const handlers = Object.entries(modules).flatMap(([file, mod]) =>
  METHODS.filter((m) => typeof mod[m] === "function").map((m) => ({
    name: `${m} ${file}`,
    method: m,
    fn: mod[m] as (req: Request, ctx: unknown) => Promise<Response>,
  })),
);

function call(h: (typeof handlers)[number]) {
  const body = h.method === "GET" ? undefined : JSON.stringify({ kind: "teach", session_id: "s1", t: 1, frame: "x" });
  return h.fn(new Request("http://localhost/api/x?role=tutor&session_id=s1", { method: h.method, body }), {
    params: Promise.resolve({ id: "s1", name: "0001.jpg" }),
  });
}

beforeEach(() => {
  state.mode = "supabase";
  state.user = null;
  state.membershipError = false;
  state.calls = [];
  vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("no network in tests"))));
});

describe("every API route requires a context", () => {
  it("covers the routes named in the spec", () => {
    const files = Object.keys(modules);
    for (const f of [
      "./session/route.ts",
      "./session/[id]/route.ts",
      "./session/[id]/end/route.ts",
      "./session/[id]/events/route.ts",
      "./session/[id]/frames/[name]/route.ts",
      "./session/[id]/off-record/route.ts",
      "./session/[id]/qa/route.ts",
      "./session/[id]/transcript/route.ts",
      "./vision/route.ts",
      "./workmap/route.ts",
      "./workmap/confirm/route.ts",
      "./export/route.ts",
      "./decide/route.ts",
      "./redact/route.ts",
      "./voice/signed-url/route.ts",
      "./workspace/active/route.ts",
    ]) {
      expect(files).toContain(f);
    }
  });

  it.each(handlers)("$name answers 401 when signed out", async (h) => {
    const res = await call(h);
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "unauthorized" });
    expect(state.calls).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
    expect(describeFrame).not.toHaveBeenCalled();
  });

  it.each(handlers)("$name answers 503 when misconfigured", async (h) => {
    state.mode = "misconfigured";
    const res = await call(h);
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "supabase_not_configured" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(handlers)("$name answers 403 no_workspace when memberships cannot be read", async (h) => {
    state.user = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", email: "a@example.test" };
    state.membershipError = true;
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await call(h);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "no_workspace" });
    expect(state.calls).toEqual(["from:workspace_members"]);
  });
});

describe("handle maps getStore errors", () => {
  it("supabase_not_configured -> 503, store_context_required -> 500", async () => {
    const { handle } = await import("./session/_http");
    vi.spyOn(console, "error").mockImplementation(() => {});
    const a = await handle(async () => {
      throw new Error("supabase_not_configured");
    });
    expect(a.status).toBe(503);
    expect(await a.json()).toEqual({ error: "supabase_not_configured" });
    const b = await handle(async () => {
      throw new Error("store_context_required");
    });
    expect(b.status).toBe(500);
    expect(await b.json()).toEqual({ error: "store_context_required" });
  });
});
