// Request-scoped context: getRequestContext resolves the user once per request; requireContext never reads the cache.
// How the dedupe is tested: React's cache() memoizes only inside a React server request, which vitest does not run,
// so 'react' is mocked with the same semantics: one memo store per request, keyed by function and arguments.
// newRequest() starts the next request with an empty store, which also shows nothing survives across requests.
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ store: new Map<unknown, unknown>(), getUser: null as unknown as ReturnType<typeof import("vitest").vi.fn> }));

vi.mock("react", async (orig) => ({
  ...(await orig<typeof import("react")>()),
  cache:
    <A extends unknown[], R>(fn: (...args: A) => R) =>
    (...args: A): R => {
      const key = JSON.stringify([String(fn), args]);
      if (!s.store.has(key)) s.store.set(key, fn(...args));
      return s.store.get(key) as R;
    },
}));
vi.mock("@/lib/supabase/env", () => ({ appMode: () => "supabase" }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const rows = [{ workspace_id: "ws1", role: "owner", created_at: "2026-10-01T00:00:00Z", workspaces: { name: "W" } }];
    const q: unknown = new Proxy(
      {},
      {
        get(_t, prop) {
          if (prop === "then") return (ok: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(ok);
          return () => q;
        },
      },
    );
    return { auth: { getUser: s.getUser }, from: () => q, rpc: async () => ({ data: [], error: null }) };
  },
}));

import { getRequestContext, requireContext } from "./context";

const newRequest = () => s.store.clear();

beforeEach(() => {
  newRequest();
  s.getUser = vi.fn(async () => ({ data: { user: { id: "u1", email: null } }, error: null }));
});

describe("request-scoped getRequestContext", () => {
  it("two calls in one request resolve the user once", async () => {
    const [a, b] = await Promise.all([getRequestContext(), getRequestContext()]);
    const c = await getRequestContext();
    expect(s.getUser).toHaveBeenCalledTimes(1);
    expect(a).toBe(b);
    expect(c).toBe(a);
    expect(a).toMatchObject({ kind: "ok", ctx: { userId: "u1", workspaceId: "ws1" } });
  });

  it("a new request resolves again: no cross-request state", async () => {
    await getRequestContext();
    newRequest();
    await getRequestContext();
    expect(s.getUser).toHaveBeenCalledTimes(2);
  });

  it("requireContext (route handlers, mutating paths) bypasses the cache", async () => {
    await getRequestContext();
    await requireContext();
    await requireContext();
    expect(s.getUser).toHaveBeenCalledTimes(3);
  });
});
