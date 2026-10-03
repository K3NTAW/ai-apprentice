import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  mode: "supabase" as "local" | "supabase" | "misconfigured",
  signOutResult: { error: null } as { error: unknown } | "throw",
}));

const signOut = vi.hoisted(() => vi.fn());

vi.mock("@/lib/supabase/env", () => ({ appMode: () => state.mode }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: vi.fn(async () => ({ auth: { signOut } })),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [], set: () => {} }) }));

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { POST } from "./route";

const post = () => POST(new NextRequest("http://app.test/auth/signout", { method: "POST" }));

beforeEach(() => {
  state.mode = "supabase";
  signOut.mockReset();
  signOut.mockImplementation(async () => {
    if (state.signOutResult === "throw") throw new Error("network");
    return state.signOutResult;
  });
  state.signOutResult = { error: null };
  vi.mocked(createSupabaseServerClient).mockClear();
});

function expectRedirectAndCleared(res: Response) {
  expect(res.status).toBe(303);
  expect(res.headers.get("location")).toBe("http://app.test/");
  const cookie = res.headers.get("set-cookie") ?? "";
  expect(cookie).toMatch(/(^|,\s*)ws=;/);
  expect(cookie).toMatch(/Max-Age=0/i);
}

describe("POST /auth/signout", () => {
  it("supabase mode: signOut with scope local, 303 to / and clears ws", async () => {
    const res = await post();
    expect(signOut).toHaveBeenCalledWith({ scope: "local" });
    expectRedirectAndCleared(res);
  });

  it("still clears ws and redirects when signOut errors or throws", async () => {
    state.signOutResult = { error: { message: "x" } };
    expectRedirectAndCleared(await post());
    state.signOutResult = "throw";
    expectRedirectAndCleared(await post());
  });

  it("local mode: no Supabase, still 303 and clears ws", async () => {
    state.mode = "local";
    expectRedirectAndCleared(await post());
    expect(createSupabaseServerClient).not.toHaveBeenCalled();
    expect(signOut).not.toHaveBeenCalled();
  });
});
