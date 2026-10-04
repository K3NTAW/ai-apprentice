import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

// The recovery link opens /auth/reset in a browser with no session cookie: the proxy must let it through.
vi.mock("@/lib/supabase/env", () => ({
  appMode: () => "supabase",
  publicSupabaseEnv: () => ({ url: "http://localhost:54321", anonKey: "anon-placeholder" }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: vi.fn(() => ({
    auth: {
      getUser: vi.fn(async () => ({ data: { user: null }, error: { status: 401, message: "Auth session missing!" } })),
    },
  })),
}));

import { proxy } from "@/proxy";

const passes = (res: Response) => res.headers.get("x-middleware-next") === "1";

describe("proxy and /auth/*, signed out", () => {
  it("allows an unauthenticated GET /auth/reset (and the confirmed page)", async () => {
    for (const p of ["/auth/reset", "/auth/reset#access_token=at&refresh_token=rt", "/auth/confirmed"]) {
      const res = await proxy(new NextRequest(new URL(p, "http://app.test"), { method: "GET" }));
      expect(passes(res)).toBe(true);
      expect(res.headers.get("location")).toBeNull();
    }
  });

  it("still gates a protected page", async () => {
    const res = await proxy(new NextRequest(new URL("/agents", "http://app.test")));
    expect(passes(res)).toBe(false);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
  });
});
