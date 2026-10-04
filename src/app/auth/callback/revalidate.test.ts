// Every sign-in path that runs bootstrapAfterSignIn expires the memberships tag (T-0178), like /api/auth/bootstrap.
// next/cache records revalidateTag; the membership reads, the env and the Supabase SSR client are mocked.
import { beforeEach, describe, expect, it, vi } from "vitest";

const s = vi.hoisted(() => ({ revalidated: [] as string[], before: [] as { workspaceId: string }[], after: [] as { workspaceId: string }[] }));

vi.mock("next/cache", () => ({
  unstable_cache: (fn: () => unknown) => fn,
  revalidateTag: (tag: string) => {
    s.revalidated.push(tag);
  },
}));
vi.mock("@/lib/supabase/env", () => ({
  appMode: () => "supabase",
  publicSupabaseEnv: () => ({ url: "http://localhost:54321", anonKey: "anon-placeholder" }),
}));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: { exchangeCodeForSession: async () => ({ data: { user: { id: "u1" } }, error: null }) },
  }),
}));
vi.mock("@/lib/auth/context", () => ({
  readMemberships: async () => ({ ok: true, memberships: s.before }),
  bootstrapMemberships: async () => ({ ok: true, memberships: s.after }),
}));

import { NextRequest } from "next/server";
import { cacheTag } from "@/lib/cache/readMostly";
import { bootstrapAfterSignIn } from "@/lib/auth/signIn";
import { GET } from "./route";

beforeEach(() => {
  s.revalidated = [];
  s.before = [{ workspaceId: "w1" }];
  s.after = [{ workspaceId: "w1" }];
});

describe("membership revalidation after sign-in", () => {
  it("/auth/callback expires the user's memberships", async () => {
    const res = await GET(new NextRequest("http://app.test/auth/callback?code=abc&next=%2Fagents"));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/agents");
    expect(s.revalidated).toEqual([cacheTag.memberships("u1")]);
  });

  it("an accepted invite also expires the joined workspace's member list", async () => {
    s.after = [{ workspaceId: "w1" }, { workspaceId: "w2" }];
    await GET(new NextRequest("http://app.test/auth/callback?code=abc"));
    expect(s.revalidated).toEqual([cacheTag.memberships("u1"), cacheTag.members("w2")]);
  });

  it("bootstrapAfterSignIn itself revalidates, so every caller (callback, /api/auth/bootstrap) gets it", async () => {
    const boot = await bootstrapAfterSignIn({} as never, "u9");
    expect(boot).toEqual({ ok: true, wsCookie: null });
    expect(s.revalidated).toEqual([cacheTag.memberships("u9")]);
  });

  it("a failed bootstrap revalidates nothing", async () => {
    s.after = [];
    expect(await bootstrapAfterSignIn({} as never, "u9")).toEqual({ ok: false });
    expect(s.revalidated).toEqual([]);
  });
});
