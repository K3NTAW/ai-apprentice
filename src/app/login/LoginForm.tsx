"use client";

// Sign-in form. In a browser: the magic link, and the emailed code is accepted too. Inside the desktop app
// (window.apprentice, one-app D2): 'Email me a code', then the code; /auth/verify runs verifyOtp and the workspace
// bootstrap and returns where to go (a safe next, default /agents).
import { useEffect, useState, type FormEvent } from "react";
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
};

export default function LoginForm({ next, inApp: forced, post = browserPost, navigate }: LoginFormProps) {
  const [detected, setDetected] = useState(false);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- window.apprentice only exists on the client.
    if (forced === undefined) setDetected(getBridge() !== null);
  }, [forced]);
  const inApp = forced ?? detected;
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [state, setState] = useState<State>("idle");
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
    <p role="alert" className="text-red-700">
      {CODE_LOGIN_ERRORS[error]}
    </p>
  );

  if (state === "sent" || state === "verifying") {
    return (
      <form onSubmit={onVerify} className="flex flex-col gap-2" data-testid="code-form">
        <p>
          {inApp
            ? `We emailed a code to ${email.trim()}. Enter it here.`
            : "Check your inbox. The link signs you in on this browser, or enter the code from the email."}
        </p>
        <label className="flex flex-col gap-1">
          <span>Code</span>
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            required
            maxLength={OTP_MAX}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="rounded border px-2 py-1"
          />
        </label>
        <button type="submit" disabled={state === "verifying"} className="rounded border px-3 py-1">
          {state === "verifying" ? "Checking..." : "Sign in"}
        </button>
        <button type="button" onClick={() => setState("idle")} className="text-left text-sm underline">
          Use a different email or request a new code
        </button>
        {alert}
      </form>
    );
  }

  return (
    <form onSubmit={onSend} className="flex flex-col gap-2">
      <label className="flex flex-col gap-1">
        <span>Email</span>
        <input
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="rounded border px-2 py-1"
        />
      </label>
      <button type="submit" disabled={state === "sending"} className="rounded border px-3 py-1">
        {state === "sending" ? "Sending..." : inApp ? "Email me a code" : "Send sign-in link"}
      </button>
      {alert}
    </form>
  );
}
