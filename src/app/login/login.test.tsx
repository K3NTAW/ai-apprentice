import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as string[], verifyArgs: null as unknown }));

vi.mock("@/lib/supabase/env", () => ({
  appMode: () => "supabase",
  publicSupabaseEnv: () => ({ url: "http://localhost:54321", anonKey: "anon-placeholder" }),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      verifyOtp: async (args: unknown) => {
        state.calls.push("verifyOtp");
        state.verifyArgs = args;
        return { data: { user: { id: "u" } }, error: null };
      },
    },
    from: () => {
      const q: unknown = new Proxy({}, { get: (_t, p) => (p === "then" ? (r: (v: unknown) => unknown) => r({ data: [], error: null }) : () => q) });
      return q;
    },
    rpc: async (name: string) => {
      state.calls.push(name);
      return { data: [{ workspace_id: "11111111-1111-4111-8111-111111111111", name: "Personal", role: "owner" }], error: null };
    },
  }),
}));

import { POST } from "@/app/auth/verify/route";
import { requestCode, verifyCode, type PostJson } from "@/lib/auth/codeLogin";
import LoginForm from "./LoginForm";

/** Posts straight into the /auth/verify route handler. */
const routePost: PostJson = async (url, body) => {
  const res = await POST(
    new NextRequest(`http://app.test${url}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }),
  );
  return { status: res.status, json: await res.json() };
};

const supabase = {
  auth: {
    signInWithOtp: vi.fn(async (args: { email: string; options?: { emailRedirectTo?: string } }) => {
      void args;
      state.calls.push("signInWithOtp");
      return { error: null as { status?: number; code?: string } | null };
    }),
  },
};

beforeEach(() => {
  state.calls = [];
  state.verifyArgs = null;
  supabase.auth.signInWithOtp.mockClear();
});

describe("login page", () => {
  it("in the desktop app offers 'Email me a code'; the browser keeps the magic link", () => {
    expect(renderToStaticMarkup(<LoginForm next={null} inApp />)).toContain("Email me a code");
    const browser = renderToStaticMarkup(<LoginForm next={null} inApp={false} />);
    expect(browser).toContain("Send sign-in link");
    expect(browser).not.toContain("Email me a code");
  });

  it("code flow: signInWithOtp, then verifyOtp(type 'email'), the workspace bootstrap and /agents", async () => {
    const sent = await requestCode(supabase, " sabine@example.com ", "http://app.test/auth/callback?next=%2Fdashboard");
    expect(sent).toEqual({ ok: true });
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({
      email: "sabine@example.com",
      options: { emailRedirectTo: "http://app.test/auth/callback?next=%2Fdashboard" },
    });
    const navigate = vi.fn();
    const res = await verifyCode(routePost, { email: "sabine@example.com", token: "123 456", next: null });
    if (res.ok) navigate(res.redirect);
    expect(state.calls).toEqual(["signInWithOtp", "verifyOtp", "bootstrap_workspace"]);
    expect(state.verifyArgs).toEqual({ email: "sabine@example.com", token: "123456", type: "email" });
    expect(navigate).toHaveBeenCalledWith("/agents");
  });

  it("keeps a safe next after the code login", async () => {
    expect(await verifyCode(routePost, { email: "a@b.ch", token: "123456", next: "/teach" })).toEqual({ ok: true, redirect: "/teach" });
  });

  it("send and verify errors: rate limit, bad code format, server error codes", async () => {
    supabase.auth.signInWithOtp.mockResolvedValueOnce({ error: { status: 429 } });
    expect(await requestCode(supabase, "a@b.ch", "x")).toEqual({ ok: false, error: "rate_limited" });
    expect(await verifyCode(routePost, { email: "a@b.ch", token: "12", next: null })).toEqual({ ok: false, error: "code_invalid" });
    const expired: PostJson = async () => ({ status: 403, json: { error: "code_expired" } });
    expect(await verifyCode(expired, { email: "a@b.ch", token: "123456", next: null })).toEqual({ ok: false, error: "code_expired" });
    const setup: PostJson = async () => ({ status: 500, json: { error: "workspace_setup_failed" } });
    expect(await verifyCode(setup, { email: "a@b.ch", token: "123456", next: null })).toEqual({ ok: false, error: "workspace_setup_failed" });
    const offsite: PostJson = async () => ({ status: 200, json: { redirect: "//evil.example" } });
    expect((await verifyCode(offsite, { email: "a@b.ch", token: "123456", next: null })).ok).toBe(false);
  });
});
