// Read-mostly caches (performance 2): every key carries the user id and the workspace id, and the mutations that
// change the data expire the matching tags. next/cache is mocked: unstable_cache records its key and tags and
// memoizes by key, revalidateTag records the tags.
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({
  keys: [] as { key: string[]; tags: string[]; revalidate: unknown }[],
  memo: new Map<string, unknown>(),
  revalidated: [] as string[],
  ctx: null as unknown,
}));

vi.mock("next/cache", () => ({
  unstable_cache:
    <T,>(fn: () => Promise<T>, key: string[], opts: { tags: string[]; revalidate: unknown }) =>
    async () => {
      s.keys.push({ key, tags: opts.tags, revalidate: opts.revalidate });
      const k = JSON.stringify(key);
      if (!s.memo.has(k)) s.memo.set(k, await fn());
      return s.memo.get(k) as T;
    },
  revalidateTag: (tag: string) => {
    s.revalidated.push(tag);
    for (const k of s.memo.keys()) s.memo.delete(k);
  },
}));

const fakeStore = vi.hoisted(() => ({
  recentSessions: vi.fn(async () => [] as unknown[]),
  listAgents: vi.fn(async () => [] as unknown[]),
}));
vi.mock("@/lib/store", async (orig) => ({ ...(await orig<typeof import("@/lib/store")>()), getStore: () => fakeStore }));
vi.mock("@/lib/dashboard/load", () => ({ loadDashboardInput: async () => ({ sessions: [], members: [], createdBy: {} }) }));

import { withMutation } from "@/app/api/session/_http";
import type { RequestContext } from "@/lib/auth/context";
import { recentSessions } from "@/components/shell/AppShell";
import { cachedMemberships } from "@/lib/auth/context";
import { loadAgentsInput } from "@/lib/dashboard/agents";
import { cacheKey, cacheTag, readMostly, revalidateScopes } from "./readMostly";

vi.mock("@/lib/auth/context", async (orig) => ({
  ...(await orig<typeof import("@/lib/auth/context")>()),
  requireContext: async () => s.ctx,
}));

const ctx = (userId: string, workspaceId: string) =>
  ({ mode: "supabase", userId, workspaceId, supabase: { from: () => null }, role: "owner" }) as unknown as RequestContext;

beforeEach(() => {
  s.keys = [];
  s.memo.clear();
  s.revalidated = [];
  fakeStore.recentSessions.mockClear();
  fakeStore.listAgents.mockClear();
});

const lastKey = () => s.keys.at(-1)!;

describe("cache keys", () => {
  it("carry the user id and the workspace id; a missing id throws", () => {
    expect(cacheKey("x", { userId: "u1", workspaceId: "w1" })).toEqual(["x", "user:u1", "ws:w1"]);
    expect(() => cacheKey("x", { userId: "", workspaceId: "w1" })).toThrow();
    expect(() => cacheKey("x", { userId: "u1", workspaceId: "" })).toThrow();
  });

  it("recent sessions (sidebar): keyed by user and workspace, tagged with the workspace's sessions", async () => {
    await recentSessions(ctx("u1", "w1"));
    expect(lastKey().key).toEqual(expect.arrayContaining(["user:u1", "ws:w1"]));
    expect(lastKey().tags).toEqual([cacheTag.sessions("w1")]);
    expect(lastKey().revalidate).toBeLessThanOrEqual(10);
  });

  it("agents input (agent list and stats): keyed by user and workspace, tagged agents, sessions, members", async () => {
    await loadAgentsInput(ctx("u1", "w1"));
    expect(lastKey().key).toEqual(expect.arrayContaining(["user:u1", "ws:w1"]));
    expect(lastKey().tags).toEqual([cacheTag.agents("w1"), cacheTag.sessions("w1"), cacheTag.members("w1")]);
  });

  it("memberships: keyed by user and requested workspace, tagged with the user's memberships", async () => {
    const rows = [{ workspace_id: "w1", role: "owner", created_at: "2026-10-01T00:00:00Z", workspaces: { name: "W" } }];
    const q: unknown = new Proxy({}, { get: (_t, p) => (p === "then" ? (ok: (v: unknown) => unknown) => ok({ data: rows, error: null }) : () => q) });
    await cachedMemberships({ from: () => q } as never, "u1", "w1");
    expect(lastKey().key).toEqual(expect.arrayContaining(["user:u1", "ws:w1"]));
    expect(lastKey().tags).toEqual([cacheTag.memberships("u1")]);
  });

  it("never shares across users or workspaces", async () => {
    let n = 0;
    const read = async () => ++n;
    expect(await readMostly("x", { userId: "u1", workspaceId: "w1" }, ["agents"], read)).toBe(1);
    expect(await readMostly("x", { userId: "u1", workspaceId: "w1" }, ["agents"], read)).toBe(1);
    expect(await readMostly("x", { userId: "u2", workspaceId: "w1" }, ["agents"], read)).toBe(2);
    expect(await readMostly("x", { userId: "u1", workspaceId: "w2" }, ["agents"], read)).toBe(3);
  });

  it("local mode reads the store directly, no cache", async () => {
    await recentSessions({ mode: "local", userId: "local", workspaceId: "local", supabase: null } as unknown as RequestContext);
    expect(s.keys).toEqual([]);
    expect(fakeStore.recentSessions).toHaveBeenCalledTimes(1);
  });
});

describe("mutations revalidate the tags", () => {
  it("withMutation expires the scopes of the active workspace after a 2xx, not after an error", async () => {
    s.ctx = ctx("u1", "w1");
    await withMutation(["agents"], async () => Response.json({}, { status: 201 }));
    expect(s.revalidated).toEqual([cacheTag.agents("w1")]);
    s.revalidated = [];
    await withMutation(["sessions"], async () => Response.json({ error: "forbidden" }, { status: 403 }));
    expect(s.revalidated).toEqual([]);
  });

  it("a write after a cached read makes the next read fresh", async () => {
    let n = 0;
    const ids = { userId: "u1", workspaceId: "w1" };
    await readMostly("agents-input", ids, ["agents"], async () => ++n);
    revalidateScopes(["agents"], ids);
    expect(await readMostly("agents-input", ids, ["agents"], async () => ++n)).toBe(2);
  });

  const src = (rel: string) => readFileSync(path.join(process.cwd(), "src/app/api", rel), "utf8");
  const writers = (code: string) => [...code.matchAll(/export (?:async )?function (POST|PATCH|PUT|DELETE)\([^\n]*\n\s*return (\w+)\((\[[^\]]*\])?/g)];

  it("agent writes (POST, PATCH, DELETE) expire 'agents'", () => {
    const found = [...writers(src("agents/route.ts")), ...writers(src("agents/[id]/route.ts"))];
    expect(found.map((m) => m[1]).sort()).toEqual(["DELETE", "PATCH", "POST"]);
    for (const m of found) expect(`${m[2]}${m[3]}`, m[1]).toBe('withMutation["agents"]');
  });

  it("session writes expire 'sessions' (sidebar recents and agent stats)", () => {
    for (const rel of [
      "session/route.ts",
      "session/[id]/events/route.ts",
      "session/[id]/transcript/route.ts",
      "session/[id]/qa/route.ts",
      "session/[id]/off-record/route.ts",
      "session/[id]/end/route.ts",
      "vision/route.ts",
      "workmap/route.ts",
      "workmap/confirm/route.ts",
    ]) {
      const found = writers(src(rel));
      expect(found.length, rel).toBeGreaterThan(0);
      for (const m of found) expect(`${m[2]}${m[3]}`, rel).toBe('withMutation["sessions"]');
    }
  });

  it("membership changes expire 'memberships' (bootstrap, member removal)", () => {
    expect(src("auth/bootstrap/route.ts")).toContain('revalidateScopes(["memberships"], ctx)');
    expect(src("workspace/members/route.ts")).toContain('revalidateScopes(["memberships"], { userId: input.userId');
  });
});
