// Server-Timing on API responses (T-0178): ctx-auth (requireContext), db (sum of the store calls) and total.
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ ctx: null as unknown }));
const fakeStore = vi.hoisted(() => ({
  listSessions: async () => {
    await new Promise((r) => setTimeout(r, 20));
    return [];
  },
}));
vi.mock("@/lib/store", async (orig) => ({ ...(await orig<typeof import("@/lib/store")>()), getStore: () => fakeStore }));
vi.mock("@/lib/auth/context", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/context")>()),
  requireContext: async () => s.ctx,
}));

import { withApi } from "./_http";

const timing = (res: Response) =>
  Object.fromEntries(
    (res.headers.get("server-timing") ?? "")
      .split(",")
      .map((e) => e.trim().match(/^([\w-]+);dur=([\d.]+)$/))
      .filter((m): m is RegExpMatchArray => !!m)
      .map((m) => [m[1], Number(m[2])]),
  );

beforeEach(() => {
  s.ctx = { mode: "local", userId: "local", workspaceId: "local", supabase: null, role: "owner" };
});

describe("withApi Server-Timing", () => {
  it("lists ctx-auth, db and total; db is the store time", async () => {
    const res = await withApi(async ({ store }) => {
      await store.listSessions();
      await store.listSessions();
      return Response.json({ ok: true });
    });
    const t = timing(res);
    expect(Object.keys(t)).toEqual(["ctx-auth", "db", "total"]);
    expect(t.db).toBeGreaterThanOrEqual(35);
    expect(t.total).toBeGreaterThanOrEqual(t.db);
  });

  it("a 401 from requireContext still carries ctx-auth, db and total", async () => {
    s.ctx = Response.json({ error: "unauthorized" }, { status: 401 });
    const res = await withApi(async () => Response.json({}));
    expect(res.status).toBe(401);
    expect(Object.keys(timing(res))).toEqual(["ctx-auth", "db", "total"]);
  });
});
