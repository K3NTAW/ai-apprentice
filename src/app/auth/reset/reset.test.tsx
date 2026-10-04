import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/env", () => ({
  appMode: () => "supabase",
  publicSupabaseEnv: () => ({ url: "http://localhost:54321", anonKey: "anon-placeholder" }),
}));

import {
  readRecoveryTokens,
  requestPasswordReset,
  startRecovery,
  updatePassword,
  type ResetClient,
} from "@/lib/auth/passwordLogin";
import LoginForm from "@/app/login/LoginForm";
import ResetForm from "./ResetForm";

type Err = { status?: number; code?: string; message?: string } | null;

function resetClient(errors: { setSession?: Err; updateUser?: Err } = {}) {
  const calls: string[] = [];
  const client = {
    auth: {
      setSession: vi.fn(async (t: { access_token: string; refresh_token: string }) => {
        void t;
        calls.push("setSession");
        return { error: errors.setSession ?? null };
      }),
      updateUser: vi.fn(async (a: { password: string }) => {
        void a;
        calls.push("updateUser");
        return { error: errors.updateUser ?? null };
      }),
      signOut: vi.fn(async (o?: { scope?: "global" | "local" | "others" }) => {
        void o;
        calls.push("signOut");
        return { error: null };
      }),
    },
  } satisfies ResetClient;
  return { client, calls };
}

describe("forgot password", () => {
  it("'Forgot password?' is on the sign-in tab in the app and the browser", () => {
    expect(renderToStaticMarkup(<LoginForm next={null} inApp />)).toContain("Forgot password?");
    expect(renderToStaticMarkup(<LoginForm next={null} inApp={false} />)).toContain("Forgot password?");
  });

  it("calls resetPasswordForEmail with redirectTo <origin>/auth/reset", async () => {
    const resetPasswordForEmail = vi.fn(async (email: string, o?: { redirectTo?: string }) => {
      void email;
      void o;
      return { error: null };
    });
    expect(await requestPasswordReset({ auth: { resetPasswordForEmail } }, " sabine@example.com ", "https://app.example")).toEqual({ ok: true });
    expect(resetPasswordForEmail).toHaveBeenCalledWith("sabine@example.com", { redirectTo: "https://app.example/auth/reset" });
  });

  it("rate limit and failures map to plain messages", async () => {
    const limited = { auth: { resetPasswordForEmail: async () => ({ error: { status: 429 } }) } };
    expect(await requestPasswordReset(limited, "a@b.ch", "https://app.example")).toEqual({ ok: false, error: "rate_limited" });
    const broken = { auth: { resetPasswordForEmail: async () => ({ error: { status: 500 } }) } };
    expect(await requestPasswordReset(broken, "a@b.ch", "https://app.example")).toEqual({ ok: false, error: "send_failed" });
    expect(await requestPasswordReset(broken, "  ", "https://app.example")).toEqual({ ok: false, error: "bad_request" });
  });
});

describe("/auth/reset", () => {
  it("reads the recovery tokens from the link hash", () => {
    expect(readRecoveryTokens("#access_token=at&expires_in=3600&refresh_token=rt&token_type=bearer&type=recovery")).toEqual({
      access_token: "at",
      refresh_token: "rt",
    });
    expect(readRecoveryTokens("")).toBeNull();
    expect(readRecoveryTokens("#error=access_denied&error_code=otp_expired")).toBeNull();
  });

  it("starts the session, updates the password, signs out, and tells the user to sign in again in the app", async () => {
    const { client, calls } = resetClient();
    expect(await startRecovery(client, readRecoveryTokens("#access_token=at&refresh_token=rt"))).toEqual({ ok: true });
    expect(client.auth.setSession).toHaveBeenCalledWith({ access_token: "at", refresh_token: "rt" });
    expect(await updatePassword(client, "new-password", "new-password")).toEqual({ ok: true });
    expect(client.auth.updateUser).toHaveBeenCalledWith({ password: "new-password" });
    expect(calls).toEqual(["setSession", "updateUser", "signOut"]);
    // Global sign-out after updateUser: older sessions (other devices, the app) are revoked too.
    expect(client.auth.signOut).toHaveBeenCalledWith({ scope: "global" });
    const done = renderToStaticMarkup(<ResetForm client={client} initialState="done" />);
    expect(done).toContain("Password changed");
    expect(done).toContain("Sign in again in the app");
  });

  it("checks the new password before updateUser; maps a weak password", async () => {
    const { client } = resetClient({ updateUser: { status: 422, code: "weak_password" } });
    expect(await updatePassword(client, "short", "short")).toEqual({ ok: false, error: "password_too_short" });
    expect(await updatePassword(client, "new-password", "new-passwore")).toEqual({ ok: false, error: "password_mismatch" });
    expect(client.auth.updateUser).not.toHaveBeenCalled();
    expect(await updatePassword(client, "new-password", "new-password")).toEqual({ ok: false, error: "weak_password" });
    expect(client.auth.signOut).not.toHaveBeenCalled();
  });

  it("an invalid or expired link is reported, no password form", async () => {
    const { client } = resetClient({ setSession: { status: 403, code: "otp_expired" } });
    expect(await startRecovery(client, null)).toEqual({ ok: false, error: "link_invalid" });
    expect(await startRecovery(client, { access_token: "a", refresh_token: "r" })).toEqual({ ok: false, error: "link_invalid" });
    const invalid = renderToStaticMarkup(<ResetForm client={client} initialState="invalid" />);
    expect(invalid).toContain("Link not valid");
    expect(invalid).not.toContain('id="reset-password"');
  });

  it("the form: new password and confirm, minimum 8, show/hide", () => {
    const { client } = resetClient();
    const html = renderToStaticMarkup(<ResetForm client={client} initialState="ready" />);
    for (const t of ['id="reset-password"', 'id="reset-confirm"', 'minLength="8"', "Show", "Set new password"]) expect(html).toContain(t);
  });
});
