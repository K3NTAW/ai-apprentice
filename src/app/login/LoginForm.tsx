"use client";

// Sign-in form. In a browser: the magic link, and the emailed code is accepted too. Inside the desktop app
// (window.apprentice, one-app D2): 'Email me a code', then the code; /auth/verify runs verifyOtp and the workspace
// bootstrap and returns where to go (a safe next, default /agents).
// Look: Login.dc.html (idle) and LoginSent.dc.html (the sent state of the same route).
import { useEffect, useState, type FormEvent } from "react";
import { buttonClass } from "@/components/ui";
import { safeNext } from "@/lib/auth/redirect";
import { browserPost, CODE_LOGIN_ERRORS, OTP_MAX, requestCode, verifyCode, type PostJson } from "@/lib/auth/codeLogin";
import { getBridge } from "@/lib/companion/transport";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type State = "idle" | "sending" | "sent" | "verifying";
type ErrorKey = keyof typeof CODE_LOGIN_ERRORS;

export type LoginFormProps = {
  /** A safe next path from ?next, or null when none was given. */
  next: string | null;
  /** Tests: force desktop app (true) or browser (false); otherwise detected after mount. */
  inApp?: boolean;
  post?: PostJson;
  navigate?: (path: string) => void;
  /** Tests: render the sent state (LoginSent.dc.html) for this address. */
  initialSent?: string;
};

const primaryWide = buttonClass("primary", "md", "h-12 w-full text-[15px]");

export default function LoginForm({ next, inApp: forced, post = browserPost, navigate, initialSent }: LoginFormProps) {
  const [detected, setDetected] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window.apprentice only exists on the client.
    if (forced === undefined) setDetected(getBridge() !== null);
  }, [forced]);
  const inApp = forced ?? detected;
  const [email, setEmail] = useState(initialSent ?? "");
  const [code, setCode] = useState("");
  const [state, setState] = useState<State>(initialSent ? "sent" : "idle");
  const [error, setError] = useState<ErrorKey | null>(null);

  async function onSend(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    setError(null);
    const emailRedirectTo = `${location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
    const res = await requestCode(createSupabaseBrowserClient(), email, emailRedirectTo);
    if (res.ok) setState("sent");
    else {
      setState("idle");
      setError(res.error);
    }
  }

  async function onVerify(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("verifying");
    setError(null);
    const res = await verifyCode(post, { email, token: code, next });
    if (res.ok) {
      (navigate ?? ((p: string) => location.assign(p)))(res.redirect);
      return;
    }
    setState("sent");
    setError(res.error);
  }

  const alert = error && (
    <p role="alert" className="text-sm" style={{ color: "var(--rd)" }}>
      {CODE_LOGIN_ERRORS[error]}
    </p>
  );

  if (state === "sent" || state === "verifying") {
    return (
      <form onSubmit={onVerify} className="flex flex-col gap-6" data-testid="code-form" data-screen="login-sent">
        <div className="flex flex-col gap-2">
          <h1 className="ui-t1">Check your email</h1>
          <p className="text-[15px]" style={{ color: "var(--mu)" }}>
            {inApp ? "We emailed a code to " : "We sent a sign-in link to "}
            <span className="font-medium" style={{ color: "var(--tx)" }}>
              {email.trim()}
            </span>
            {inApp ? ". Enter it here." : ". It works once and expires in 15 minutes."}
          </p>
        </div>
        {!inApp && (
          <div className="flex flex-col gap-2.5 rounded-[12px] px-4 py-3.5" style={{ background: "var(--s2)" }}>
            <span className="text-xs" style={{ color: "var(--mu)" }}>
              Subject to look for
            </span>
            <span className="text-sm font-medium">Your AI Apprentice sign-in link</span>
          </div>
        )}
        <div>
          <label className="ui-lbl" htmlFor="login-code">
            {inApp ? "Code" : "Or enter the code from the email"}
          </label>
          <input
            id="login-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={OTP_MAX}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="ui-inp ui-mono"
          />
        </div>
        <button type="submit" disabled={state === "verifying"} className={primaryWide}>
          {state === "verifying" ? "Checking..." : "Sign in"}
        </button>
        <div className="flex flex-wrap gap-2.5">
          <button type="button" onClick={() => setState("idle")} className={buttonClass("ghost")}>
            Use a different email
          </button>
        </div>
        {alert}
        <p className="text-xs" style={{ color: "var(--fa)" }}>
          No mail after a minute? Check the spam folder, or ask your owner to confirm your address.
        </p>
      </form>
    );
  }

  return (
    <form onSubmit={onSend} className="flex flex-col gap-6" data-screen="login">
      <div className="flex flex-col gap-2">
        <h1 className="ui-t1">Sign in</h1>
        <p className="text-[15px]" style={{ color: "var(--mu)" }}>
          {inApp ? "We email you a one-time code. No password to remember." : "We email you a one-time link. No password to remember."}
        </p>
      </div>
      <div className="flex flex-col gap-4">
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
        <button type="submit" disabled={state === "sending"} className={primaryWide}>
          {state === "sending" ? "Sending..." : inApp ? "Email me a code" : "Email me a sign-in link"}
        </button>
      </div>
      {alert}
      <p className="text-xs" style={{ color: "var(--fa)" }}>
        New here? Your workspace owner sends the first invite.
      </p>
    </form>
  );
}
