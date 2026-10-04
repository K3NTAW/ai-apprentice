"use client";

// Sign-in form (T-0160). Desktop app (window.apprentice): email + password with 'Sign in' and 'Create account'
// tabs. Browser: email + password and 'Email me a link' (the magic link). After the password step
// /api/auth/bootstrap runs the workspace bootstrap and returns where to go (a safe next, default /agents).
// 'Forgot password?' emails a reset link to /auth/reset. Look: Login.dc.html and LoginSent.dc.html.
import { useEffect, useState, type FormEvent } from "react";
import { buttonClass, Tabs } from "@/components/ui";
import { safeNext } from "@/lib/auth/redirect";
import {
  AUTH_ERRORS,
  PASSWORD_MIN,
  browserPost,
  loginView,
  requestMagicLink,
  requestPasswordReset,
  resendConfirmation,
  signInWithPassword,
  signUpWithPassword,
  signupRedirectTo,
  type AuthErrorCode,
  type AuthResult,
  type LoginMethod,
  type PasswordTab,
  type PostJson,
} from "@/lib/auth/passwordLogin";
import { createRecoveryClient } from "@/lib/auth/recoveryClient";
import { getBridge } from "@/lib/companion/transport";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type Screen = "form" | "forgot" | "link_sent" | "reset_sent" | "confirm_email";

export type LoginFormProps = {
  /** A safe next path from ?next, or null when none was given. */
  next: string | null;
  /** Tests: force desktop app (true) or browser (false); otherwise detected after mount. */
  inApp?: boolean;
  post?: PostJson;
  navigate?: (path: string) => void;
  /** Tests: render the link sent state (LoginSent.dc.html) for this address. */
  initialSent?: string;
  /** Tests: render the confirm-your-inbox state (after 'Create account' or 'Email not confirmed') for this address. */
  initialConfirm?: string;
  /** Tests: start on this tab / method. */
  initialTab?: PasswordTab;
  initialMethod?: LoginMethod;
};

const primaryWide = buttonClass("primary", "md", "h-12 w-full text-[15px]");

export default function LoginForm({
  next,
  inApp: forced,
  post = browserPost,
  navigate,
  initialSent,
  initialConfirm,
  initialTab,
  initialMethod,
}: LoginFormProps) {
  const [detected, setDetected] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window.apprentice only exists on the client.
    if (forced === undefined) setDetected(getBridge() !== null);
  }, [forced]);
  const inApp = forced ?? detected;
  const view = loginView(inApp);

  const [screen, setScreen] = useState<Screen>(initialSent ? "link_sent" : initialConfirm ? "confirm_email" : "form");
  const [method, setMethodState] = useState<LoginMethod>(initialMethod ?? "password");
  const activeMethod: LoginMethod = view.methods.includes(method) ? method : "password";
  const [tab, setTab] = useState<PasswordTab>(initialTab ?? "signin");
  const [email, setEmail] = useState(initialSent ?? initialConfirm ?? "");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [resent, setResent] = useState(false);

  const go = (path: string) => (navigate ?? ((p: string) => location.assign(p)))(path);
  const reset = () => {
    setError(null);
    setBusy(false);
    setResent(false);
  };
  const setMethod = (m: LoginMethod) => {
    setMethodState(m);
    reset();
  };

  function finish(res: AuthResult) {
    if (res.kind === "redirect") {
      go(res.to);
      return;
    }
    setBusy(false);
    if (res.kind === "confirm_email") setScreen("confirm_email");
    else setError(res.error);
  }

  async function onPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const supabase = createSupabaseBrowserClient();
    if (tab === "signin") {
      finish(await signInWithPassword(supabase, post, { email, password, next }));
    } else {
      const emailRedirectTo = signupRedirectTo(location.origin, next);
      finish(await signUpWithPassword(supabase, post, { email, password, confirm, next, emailRedirectTo }));
    }
  }

  async function onResend() {
    setBusy(true);
    setError(null);
    setResent(false);
    const res = await resendConfirmation(createSupabaseBrowserClient(), email, signupRedirectTo(location.origin, next));
    setBusy(false);
    if (res.ok) setResent(true);
    else setError(res.error);
  }

  async function onLink(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const emailRedirectTo = `${location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
    const res = await requestMagicLink(createSupabaseBrowserClient(), email, emailRedirectTo);
    setBusy(false);
    if (res.ok) setScreen("link_sent");
    else setError(res.error);
  }

  async function onForgot(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const res = await requestPasswordReset(createRecoveryClient(), email, location.origin);
    setBusy(false);
    if (res.ok) setScreen("reset_sent");
    else setError(res.error);
  }

  const alert = error && (
    <p role="alert" className="text-sm" style={{ color: "var(--rd)" }}>
      {AUTH_ERRORS[error]}
    </p>
  );
  const back = (
    <div className="flex flex-wrap gap-2.5">
      <button
        type="button"
        onClick={() => {
          setScreen("form");
          reset();
        }}
        className={buttonClass("ghost")}
      >
        {screen === "link_sent" ? "Use a different email" : "Back to sign in"}
      </button>
    </div>
  );
  const address = (
    <span className="font-medium" style={{ color: "var(--tx)" }}>
      {email.trim()}
    </span>
  );
  const emailField = (
    <div>
      <label className="ui-lbl" htmlFor="login-email">
        Work email
      </label>
      <input
        id="login-email"
        type="email"
        required
        autoComplete="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        className="ui-inp"
      />
    </div>
  );

  if (screen === "confirm_email") {
    return (
      <div className="flex flex-col gap-6" data-screen="login-confirm">
        <div className="flex flex-col gap-2">
          <h1 className="ui-t1">Confirm your email</h1>
          <p className="text-[15px]" style={{ color: "var(--mu)" }}>
            {AUTH_ERRORS.email_not_confirmed}
          </p>
          <p className="text-sm" style={{ color: "var(--mu)" }}>
            Sent to {address}.
          </p>
        </div>
        <div className="flex flex-col gap-2.5 rounded-[12px] px-4 py-3.5" style={{ background: "var(--s2)" }}>
          <span className="text-xs" style={{ color: "var(--mu)" }}>
            Subject to look for
          </span>
          <span className="text-sm font-medium">Confirm your signup</span>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" disabled={busy} onClick={onResend} className={buttonClass("secondary")}>
            {busy ? "Sending..." : "Resend confirmation"}
          </button>
          <button
            type="button"
            onClick={() => {
              setScreen("form");
              setTab("signin");
              reset();
            }}
            className={buttonClass("ghost")}
          >
            Back to sign in
          </button>
        </div>
        {resent && (
          <p role="status" className="text-sm" style={{ color: "var(--mu)" }}>
            Sent again. Check your inbox.
          </p>
        )}
        {alert}
      </div>
    );
  }

  if (screen === "link_sent" || screen === "reset_sent") {
    const copy = {
      link_sent: { lead: "We sent a sign-in link to ", tail: ". It works once and expires in 15 minutes.", subject: "Your AI Apprentice sign-in link" },
      reset_sent: { lead: "If an account exists for ", tail: ", we sent a link to set a new password. Open it in your browser.", subject: "Reset your password" },
    }[screen];
    return (
      <div className="flex flex-col gap-6" data-screen="login-sent">
        <div className="flex flex-col gap-2">
          <h1 className="ui-t1">Check your email</h1>
          <p className="text-[15px]" style={{ color: "var(--mu)" }}>
            {copy.lead}
            {address}
            {copy.tail}
          </p>
        </div>
        <div className="flex flex-col gap-2.5 rounded-[12px] px-4 py-3.5" style={{ background: "var(--s2)" }}>
          <span className="text-xs" style={{ color: "var(--mu)" }}>
            Subject to look for
          </span>
          <span className="text-sm font-medium">{copy.subject}</span>
        </div>
        {back}
        <p className="text-xs" style={{ color: "var(--fa)" }}>
          No mail after a minute? Check the spam folder, or ask your owner to confirm your address.
        </p>
      </div>
    );
  }

  if (screen === "forgot") {
    return (
      <form onSubmit={onForgot} className="flex flex-col gap-6" data-screen="login-forgot">
        <div className="flex flex-col gap-2">
          <h1 className="ui-t1">Reset your password</h1>
          <p className="text-[15px]" style={{ color: "var(--mu)" }}>
            We email you a link. Open it in your browser and choose a new password.
          </p>
        </div>
        <div className="flex flex-col gap-4">
          {emailField}
          <button type="submit" disabled={busy} className={primaryWide}>
            {busy ? "Sending..." : "Email me a reset link"}
          </button>
        </div>
        {alert}
        {back}
      </form>
    );
  }

  const signup = tab === "signup";
  const passwordFields = (
    <>
      <div>
        <label className="ui-lbl" htmlFor="login-password">
          Password
        </label>
        <div className="relative">
          <input
            id="login-password"
            type={show ? "text" : "password"}
            required
            minLength={signup ? PASSWORD_MIN : undefined}
            autoComplete={signup ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="ui-inp pr-20"
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            aria-pressed={show}
            className={buttonClass("ghost", "md", "absolute top-1/2 right-1.5 h-9 -translate-y-1/2 px-3")}
          >
            {show ? "Hide" : "Show"}
          </button>
        </div>
        {signup && (
          <p className="mt-1.5 text-xs" style={{ color: "var(--fa)" }}>
            At least {PASSWORD_MIN} characters.
          </p>
        )}
      </div>
      {signup && (
        <div>
          <label className="ui-lbl" htmlFor="login-confirm">
            Confirm password
          </label>
          <input
            id="login-confirm"
            type={show ? "text" : "password"}
            required
            minLength={PASSWORD_MIN}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="ui-inp"
          />
        </div>
      )}
    </>
  );

  return (
    <div className="flex flex-col gap-6" data-screen="login">
      <div className="flex flex-col gap-2">
        <h1 className="ui-t1">{activeMethod === "password" && signup ? "Create account" : "Sign in"}</h1>
        <p className="text-[15px]" style={{ color: "var(--mu)" }}>
          {activeMethod === "link"
            ? "We email you a one-time link. No password to remember."
            : signup
              ? "Use your work email and choose a password."
              : "Use your work email and password."}
        </p>
      </div>
      {activeMethod === "password" ? (
        <form onSubmit={onPassword} className="flex flex-col gap-4" data-method="password">
          <Tabs
            tabs={view.tabs}
            active={tab}
            onSelect={(id) => {
              setTab(id as PasswordTab);
              reset();
            }}
          />
          {emailField}
          {passwordFields}
          <button type="submit" disabled={busy} className={primaryWide}>
            {busy ? (signup ? "Creating..." : "Signing in...") : signup ? "Create account" : "Sign in"}
          </button>
          {!signup && (
            <button
              type="button"
              onClick={() => {
                setScreen("forgot");
                reset();
              }}
              className={buttonClass("ghost", "md", "self-start px-0")}
            >
              Forgot password?
            </button>
          )}
        </form>
      ) : (
        <form onSubmit={onLink} className="flex flex-col gap-4" data-method="link">
          {emailField}
          <button type="submit" disabled={busy} className={primaryWide}>
            {busy ? "Sending..." : "Email me a sign-in link"}
          </button>
        </form>
      )}
      {alert}
      {view.methods.includes("link") && (
        <button
          type="button"
          onClick={() => setMethod(activeMethod === "password" ? "link" : "password")}
          className={buttonClass("secondary", "md", "w-full")}
        >
          {activeMethod === "password" ? "Email me a link" : "Email + password"}
        </button>
      )}
      <p className="text-xs" style={{ color: "var(--fa)" }}>
        New here? Create an account with your work email; your workspace owner can also send an invite.
      </p>
    </div>
  );
}
