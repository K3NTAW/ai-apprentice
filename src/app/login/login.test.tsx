import { NextRequest } from "next/server";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ calls: [] as string[], user: "u" as string | null }));
const MEMBERS = vi.hoisted(() => [{ workspace_id: "11111111-1111-4111-8111-111111111111", role: "owner", created_at: "2026-10-04", workspaces: { name: "Personal" } }]);

vi.mock("@/lib/supabase/env", () => ({
  appMode: () => "supabase",
  publicSupabaseEnv: () => ({ url: "http://localhost:54321", anonKey: "anon-placeholder" }),
}));

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, getAll: () => [] }) }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => ({
    auth: {
      getUser: async () => {
        state.calls.push("getUser");
        return state.user
          ? { data: { user: { id: state.user, email_confirmed_at: "2026-10-04T05:00:00Z" } }, error: null }
          : { data: { user: null }, error: { status: 401 } };
      },
    },
    from: () => {
      const q: unknown = new Proxy({}, { get: (_t, p) => (p === "then" ? (r: (v: unknown) => unknown) => r({ data: MEMBERS, error: null }) : () => q) });
      return q;
    },
    rpc: async (name: string) => {
      state.calls.push(name);
      return { data: [{ workspace_id: "11111111-1111-4111-8111-111111111111", name: "Personal", role: "owner" }], error: null };
    },
  }),
}));

import { POST } from "@/app/api/auth/bootstrap/route";
import {
  AUTH_ERRORS,
  bootstrapSession,
  loginView,
  mapAuthError,
  requestMagicLink,
  resendConfirmation,
  signInWithPassword,
  signUpWithPassword,
  signupRedirectTo,
  type PasswordClient,
  type PostJson,
} from "@/lib/auth/passwordLogin";
import { bootstrapThrottle } from "@/lib/auth/throttle";
import LoginForm from "./LoginForm";

/** Posts straight into the /api/auth/bootstrap route handler, with the session cookie the browser client set. */
const routePost: PostJson = async (url, body) => {
  state.calls.push(`POST ${url}`);
  const res = await POST(
    new NextRequest(`http://app.test${url}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: "sb-test-auth-token=session" },
      body: JSON.stringify(body),
    }),
  );
  return { status: res.status, json: await res.json() };
};

type Err = { status?: number; code?: string; message?: string } | null;
const result = vi.hoisted(() => ({ signIn: null as Err, signUp: null as Err, session: true as boolean }));

const supabase = {
  auth: {
    signInWithPassword: vi.fn(async (args: { email: string; password: string }) => {
      void args;
      state.calls.push("signInWithPassword");
      return { error: result.signIn };
    }),
    signUp: vi.fn(async (args: { email: string; password: string; options?: { emailRedirectTo?: string } }) => {
      void args;
      state.calls.push("signUp");
      return { data: { session: result.session ? {} : null }, error: result.signUp };
    }),
    signInWithOtp: vi.fn(async (args: { email: string; options?: { emailRedirectTo?: string } }) => {
      void args;
      state.calls.push("signInWithOtp");
      return { error: null as Err };
    }),
  },
};
const typed: PasswordClient = supabase;
void typed;

beforeEach(() => {
  state.calls = [];
  state.user = "u";
  result.signIn = null;
  result.signUp = null;
  result.session = true;
  bootstrapThrottle.reset();
  vi.clearAllMocks();
});

describe("login view per environment", () => {
  it("desktop app: email + password with 'Sign in' / 'Create account' tabs, no link, no code", () => {
    expect(loginView(true)).toEqual({
      methods: ["password"],
      tabs: [
        { id: "signin", label: "Sign in" },
        { id: "signup", label: "Create account" },
      ],
    });
    const app = renderToStaticMarkup(<LoginForm next={null} inApp />);
    for (const t of ['role="tablist"', ">Sign in<", ">Create account<", 'id="login-email"', 'id="login-password"', "Forgot password?", "Show"]) {
      expect(app).toContain(t);
    }
    expect(app).not.toContain("Email me a link");
    expect(app).not.toContain("one-time-code");
    expect(app).not.toContain("Email me a code");
  });

  it("desktop app 'Create account': password and confirm, minimum 8 characters", () => {
    const app = renderToStaticMarkup(<LoginForm next={null} inApp initialTab="signup" />);
    expect(app).toContain('id="login-confirm"');
    expect(app).toContain('minLength="8"');
    expect(app).toContain("At least 8 characters.");
    expect(app).toContain('autoComplete="new-password"');
  });

  it("browser: email + password and 'Email me a link'; the link form keeps the magic link", () => {
    expect(loginView(false).methods).toEqual(["password", "link"]);
    const web = renderToStaticMarkup(<LoginForm next={null} inApp={false} />);
    expect(web).toContain('id="login-password"');
    expect(web).toContain("Email me a link");
    const link = renderToStaticMarkup(<LoginForm next={null} inApp={false} initialMethod="link" />);
    for (const t of ["Sign in", "We email you a one-time link. No password to remember.", "Work email", "Email me a sign-in link", "Email + password"]) {
      expect(link).toContain(t);
    }
    expect(link).not.toContain('id="login-password"');
    const sent = renderToStaticMarkup(<LoginForm next={null} inApp={false} initialSent="sabine.keller@example.com" />);
    for (const t of ["Check your email", "We sent a sign-in link to ", "sabine.keller@example.com", "Subject to look for", "Use a different email"]) {
      expect(sent).toContain(t);
    }
  });

  it("the desktop app ignores a link method", () => {
    expect(renderToStaticMarkup(<LoginForm next={null} inApp initialMethod="link" />)).toContain('id="login-password"');
  });
});

describe("password flows", () => {
  it("sign in: signInWithPassword, then POST /api/auth/bootstrap, then /agents", async () => {
    const navigate = vi.fn();
    const res = await signInWithPassword(supabase, routePost, { email: " sabine@example.com ", password: "correct horse", next: null });
    if (res.kind === "redirect") navigate(res.to);
    expect(supabase.auth.signInWithPassword).toHaveBeenCalledWith({ email: "sabine@example.com", password: "correct horse" });
    expect(state.calls).toEqual(["signInWithPassword", "POST /api/auth/bootstrap", "getUser", "bootstrap_workspace"]);
    expect(navigate).toHaveBeenCalledWith("/agents");
  });

  it("sign up: signUp, then POST /api/auth/bootstrap, then /agents (keeps a safe next)", async () => {
    const res = await signUpWithPassword(supabase, routePost, {
      email: "new@example.com",
      password: "longenough",
      confirm: "longenough",
      next: "/teach",
      emailRedirectTo: "http://app.test/auth/callback",
    });
    expect(supabase.auth.signUp).toHaveBeenCalledWith({
      email: "new@example.com",
      password: "longenough",
      options: { emailRedirectTo: "http://app.test/auth/callback" },
    });
    expect(state.calls).toEqual(["signUp", "POST /api/auth/bootstrap", "getUser", "bootstrap_workspace"]);
    expect(res).toEqual({ kind: "redirect", to: "/teach" });
  });

  it("sign up checks length and confirmation before calling Supabase", async () => {
    expect(await signUpWithPassword(supabase, routePost, { email: "a@b.ch", password: "short", confirm: "short", next: null })).toEqual({
      kind: "error",
      error: "password_too_short",
    });
    expect(await signUpWithPassword(supabase, routePost, { email: "a@b.ch", password: "longenough", confirm: "longenougj", next: null })).toEqual({
      kind: "error",
      error: "password_mismatch",
    });
    expect(supabase.auth.signUp).not.toHaveBeenCalled();
  });

  it("sign up without a session (confirm email on) shows the confirm-your-inbox guidance, no bootstrap", async () => {
    result.session = false;
    expect(await signUpWithPassword(supabase, routePost, { email: "a@b.ch", password: "longenough", confirm: "longenough", next: null })).toEqual({
      kind: "confirm_email",
    });
    expect(state.calls).toEqual(["signUp"]);
    const html = renderToStaticMarkup(<LoginForm next={null} inApp initialConfirm="a@b.ch" />);
    for (const t of ["Check your inbox and click the confirmation link, then sign in here.", "a@b.ch", "Resend confirmation", "Back to sign in"]) {
      expect(html).toContain(t);
    }
    expect(html).not.toContain('id="login-password"');
  });

  it("sign-up emailRedirectTo is <origin>/auth/callback (flow=signup, safe next)", () => {
    expect(signupRedirectTo("https://app.example", null)).toBe("https://app.example/auth/callback?flow=signup&next=%2Fagents");
    expect(signupRedirectTo("https://app.example", "//evil.example")).toBe("https://app.example/auth/callback?flow=signup&next=%2Fagents");
  });

  it("'Email not confirmed' on sign in maps to the same guidance, no bootstrap", async () => {
    result.signIn = { status: 400, code: "email_not_confirmed", message: "Email not confirmed" };
    expect(await signInWithPassword(supabase, routePost, { email: "a@b.ch", password: "longenough", next: null })).toEqual({ kind: "confirm_email" });
    result.signIn = { status: 400, message: "Email not confirmed" };
    expect(await signInWithPassword(supabase, routePost, { email: "a@b.ch", password: "longenough", next: null })).toEqual({ kind: "confirm_email" });
    expect(state.calls).toEqual(["signInWithPassword", "signInWithPassword"]);
    expect(AUTH_ERRORS.email_not_confirmed).toBe("Check your inbox and click the confirmation link, then sign in here.");
  });

  it("Resend confirmation calls resend with type 'signup' and the callback; maps failures", async () => {
    const resend = vi.fn(async (args: { type: "signup"; email: string; options?: { emailRedirectTo?: string } }) => {
      void args;
      return { error: null as Err };
    });
    const redirect = signupRedirectTo("https://app.example", null);
    expect(await resendConfirmation({ auth: { resend } }, " a@b.ch ", redirect)).toEqual({ ok: true });
    expect(resend).toHaveBeenCalledWith({ type: "signup", email: "a@b.ch", options: { emailRedirectTo: redirect } });
    resend.mockResolvedValueOnce({ error: { status: 429, code: "over_email_send_rate_limit" } });
    expect(await resendConfirmation({ auth: { resend } }, "a@b.ch", redirect)).toEqual({ ok: false, error: "rate_limited" });
    resend.mockResolvedValueOnce({ error: { status: 500 } });
    expect(await resendConfirmation({ auth: { resend } }, "a@b.ch", redirect)).toEqual({ ok: false, error: "send_failed" });
    expect(await resendConfirmation({ auth: { resend } }, "  ", redirect)).toEqual({ ok: false, error: "bad_request" });
  });

  it("a bootstrap 403 email_not_confirmed also shows the guidance", async () => {
    const post: PostJson = async () => ({ status: 403, json: { error: "email_not_confirmed" } });
    expect(await bootstrapSession(post, null)).toEqual({ kind: "confirm_email" });
  });

  it("the client redirect check reuses safeNext: '/\\\\evil.com' and other unsafe targets are rejected", async () => {
    for (const redirect of ["/\\evil.com", "/\\\\evil.com", "//evil.com", "https://evil.com", "/login", "/auth/reset"]) {
      const post: PostJson = async () => ({ status: 200, json: { redirect } });
      expect(await bootstrapSession(post, null)).toEqual({ kind: "error", error: "failed" });
    }
    const ok: PostJson = async () => ({ status: 200, json: { redirect: "/teach?x=1" } });
    expect(await bootstrapSession(ok, null)).toEqual({ kind: "redirect", to: "/teach?x=1" });
  });

  it("a Supabase error stops before the bootstrap; a bootstrap 401 is a plain failure", async () => {
    result.signIn = { status: 400, code: "invalid_credentials", message: "Invalid login credentials" };
    expect(await signInWithPassword(supabase, routePost, { email: "a@b.ch", password: "x", next: null })).toEqual({ kind: "error", error: "wrong_credentials" });
    expect(state.calls).toEqual(["signInWithPassword"]);
    result.signIn = null;
    state.user = null;
    expect(await signInWithPassword(supabase, routePost, { email: "a@b.ch", password: "x", next: null })).toEqual({ kind: "error", error: "failed" });
  });

  it("magic link (browser) still uses signInWithOtp with the callback", async () => {
    expect(await requestMagicLink(supabase, " a@b.ch ", "http://app.test/auth/callback?next=%2Fdashboard")).toEqual({ ok: true });
    expect(supabase.auth.signInWithOtp).toHaveBeenCalledWith({ email: "a@b.ch", options: { emailRedirectTo: "http://app.test/auth/callback?next=%2Fdashboard" } });
  });
});

describe("Supabase errors map to plain messages", () => {
  it.each([
    [{ status: 400, code: "invalid_credentials", message: "Invalid login credentials" }, "wrong_credentials", "Wrong email or password."],
    [{ status: 400, message: "Invalid login credentials" }, "wrong_credentials", "Wrong email or password."],
    [{ status: 422, code: "user_already_exists", message: "User already registered" }, "account_exists", "An account with this email already exists. Sign in instead."],
    [{ status: 422, code: "email_exists" }, "account_exists", "An account with this email already exists. Sign in instead."],
    [{ status: 422, code: "weak_password", message: "Password should be at least 8 characters." }, "weak_password", AUTH_ERRORS.weak_password],
    [{ status: 429, code: "over_request_rate_limit" }, "rate_limited", "Too many attempts. Wait a few minutes, then try again."],
    [{ code: "over_email_send_rate_limit" }, "rate_limited", "Too many attempts. Wait a few minutes, then try again."],
    [{ status: 400, code: "email_not_confirmed" }, "email_not_confirmed", AUTH_ERRORS.email_not_confirmed],
    [{ status: 500, message: "Database error saving new user: a@b.ch" }, "failed", "That did not work. Try again."],
  ] as const)("%o -> %s", (err, code, text) => {
    expect(mapAuthError(err)).toBe(code);
    expect(AUTH_ERRORS[code]).toBe(text);
  });

  it("messages never echo the address or the Supabase text", async () => {
    result.signUp = { status: 500, message: "Database error saving new user: a@b.ch" };
    const res = await signUpWithPassword(supabase, routePost, { email: "a@b.ch", password: "longenough", confirm: "longenough", next: null });
    expect(res).toEqual({ kind: "error", error: "failed" });
    for (const text of Object.values(AUTH_ERRORS)) expect(text).not.toContain("a@b.ch");
  });
});

describe("login shell: the way to the marketing site", () => {
  it("shows 'What is AI Apprentice?' linking to NEXT_PUBLIC_MARKETING_URL, hidden when unset or not http(s)", async () => {
    const { MarketingLink, marketingUrl } = await import("@/components/landing/Landing");
    const { renderToStaticMarkup: html } = await import("react-dom/server");
    expect(html(<MarketingLink href={marketingUrl(" https://aiapprentice.example ")} />)).toMatch(/href="https:\/\/aiapprentice\.example\/"[^>]*>What is AI Apprentice\?</);
    for (const bad of [undefined, "", "  ", "javascript:alert(1)", "not a url"]) expect(marketingUrl(bad), String(bad)).toBeNull();
    expect(html(<MarketingLink href={null} />)).toBe("");
  });

  const bridge = { on: () => () => {}, send: () => {}, window: () => {} };

  it("hides the link inside the desktop app (window.apprentice present)", async () => {
    const { MarketingLink, showMarketingLink } = await import("@/components/landing/Landing");
    const { renderToStaticMarkup: html } = await import("react-dom/server");
    expect(showMarketingLink({ apprentice: bridge })).toBe(false);
    expect(html(<MarketingLink href="https://aiapprentice.example/" inApp />)).toBe("");
  });

  it("shows the link in the browser (no window.apprentice); the login shell's server render has none (mounted: marketing-link.test.tsx)", async () => {
    const { MarketingLink, LoginMarketingLink, showMarketingLink } = await import("@/components/landing/Landing");
    const { renderToStaticMarkup: html } = await import("react-dom/server");
    for (const win of [{}, undefined, { apprentice: {} }]) expect(showMarketingLink(win), JSON.stringify(win)).toBe(true);
    expect(html(<MarketingLink href="https://aiapprentice.example/" inApp={false} />)).toContain("What is AI Apprentice?");
    expect(html(<LoginMarketingLink href="https://aiapprentice.example/" />)).toBe("");
  });
});

describe("login page notices from '/'", () => {
  const render = async (error: string) => {
    const { default: LoginPage } = await import("./page");
    return renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({ error }) }));
  };

  it("error=unavailable shows the error notice above the form", async () => {
    const out = await render("unavailable");
    expect(out).toMatch(/role="alert"[^>]*>Sign-in is unavailable right now\. Try again in a moment\.</);
    expect(out).toContain('type="password"');
  });

  it("error=setup shows the setup notice", async () => {
    const out = await render("setup");
    expect(out).toContain("Sign-in is not configured on this deployment. The steps are in docs/DEPLOY.md.");
  });

  it("unknown codes show nothing and are never echoed", async () => {
    const out = await render("<b>x</b>");
    expect(out).not.toContain('role="alert"');
    expect(out).not.toContain("&lt;b&gt;");
  });
});
