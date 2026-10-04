// Magic-link callback (T-0211): a user who has not completed onboarding goes to /onboarding?next=..., a completed
// (or grandfathered) user goes straight to next.
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

const state = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/lib/supabase/env", () => ({ appMode: () => "supabase", publicSupabaseEnv: () => ({ url: "http://localhost:54321", anonKey: "anon-placeholder" }) }));
vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({ auth: { exchangeCodeForSession: async () => ({ data: { user: state.user, session: null }, error: null }) } }),
}));
vi.mock("@/lib/auth/signIn", () => ({ bootstrapAfterSignIn: async () => ({ ok: true, wsCookie: null }) }));

import { GET } from "./route";

const call = async () => {
  const url = "http://app.test/auth/callback?code=abc&next=/agents";
  const res = await GET(Object.assign(new Request(url), { cookies: { getAll: () => [] } }) as unknown as NextRequest);
  return new URL(res.headers.get("location")!).pathname + new URL(res.headers.get("location")!).search;
};

beforeEach(() => {
  delete process.env.ONBOARDING_ENABLED;
});

describe("callback onboarding redirect", () => {
  it("new user: /onboarding until onboarding_completed_at is set", async () => {
    state.user = { id: "u1", created_at: "2026-10-04T08:00:00Z", user_metadata: {} };
    expect(await call()).toBe("/onboarding?next=%2Fagents");
    state.user = { id: "u1", created_at: "2026-10-04T08:00:00Z", user_metadata: { onboarding_steps: { workspace: "skipped" } } };
    expect(await call()).toBe("/onboarding?next=%2Fagents");
    state.user = { id: "u1", created_at: "2026-10-04T08:00:00Z", user_metadata: { onboarding_completed_at: "2026-10-04T09:00:00Z" } };
    expect(await call()).toBe("/agents");
  });

  it("existing users and the kill switch skip onboarding", async () => {
    state.user = { id: "u1", created_at: "2026-09-01T08:00:00Z", user_metadata: {} };
    expect(await call()).toBe("/agents");
    process.env.ONBOARDING_ENABLED = "0";
    state.user = { id: "u1", created_at: "2026-10-04T08:00:00Z", user_metadata: {} };
    expect(await call()).toBe("/agents");
  });
});
