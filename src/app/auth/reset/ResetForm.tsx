"use client";

// /auth/reset: reads the recovery tokens from the link (URL hash), starts that session, sets the new password
// (updateUser) and signs the browser out again; the user then signs in in the app with the new password.
import { useEffect, useState, type FormEvent } from "react";
import { buttonClass } from "@/components/ui";
import {
  AUTH_ERRORS,
  PASSWORD_MIN,
  readRecoveryTokens,
  startRecovery,
  updatePassword,
  type AuthErrorCode,
  type ResetClient,
} from "@/lib/auth/passwordLogin";
import { createRecoveryClient } from "@/lib/auth/recoveryClient";

type State = "checking" | "ready" | "saving" | "done" | "invalid";

export type ResetFormProps = {
  /** Tests: the client and the starting state. */
  client?: ResetClient;
  initialState?: State;
};

const primaryWide = buttonClass("primary", "md", "h-12 w-full text-[15px]");

export default function ResetForm({ client, initialState = "checking" }: ResetFormProps) {
  const [state, setState] = useState<State>(initialState);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [error, setError] = useState<AuthErrorCode | null>(null);
  const [active, setActive] = useState<ResetClient | null>(client ?? null);

  useEffect(() => {
    if (initialState !== "checking") return;
    const c = client ?? createRecoveryClient();
    const tokens = readRecoveryTokens(location.hash);
    // Drop the tokens from the address bar and history.
    if (location.hash) history.replaceState(null, "", location.pathname + location.search);
    void startRecovery(c, tokens).then((res) => {
      setActive(c);
      setState(res.ok ? "ready" : "invalid");
    });
  }, [client, initialState]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!active) return;
    setState("saving");
    setError(null);
    const res = await updatePassword(active, password, confirm);
    if (res.ok) setState("done");
    else {
      setState("ready");
      setError(res.error);
    }
  }

  if (state === "checking") {
    return (
      <div className="flex flex-col gap-2" data-screen="reset-checking">
        <h1 className="ui-t1">Set a new password</h1>
        <p className="text-[15px]" style={{ color: "var(--mu)" }}>
          Checking the link...
        </p>
      </div>
    );
  }

  if (state === "invalid" || state === "done") {
    return (
      <div className="flex flex-col gap-2" data-screen={state === "done" ? "reset-done" : "reset-invalid"}>
        <h1 className="ui-t1">{state === "done" ? "Password changed" : "Link not valid"}</h1>
        <p className="text-[15px]" style={{ color: "var(--mu)" }}>
          {state === "done"
            ? "Your new password is set. Sign in again in the app with your email and the new password."
            : AUTH_ERRORS.link_invalid}
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6" data-screen="reset">
      <div className="flex flex-col gap-2">
        <h1 className="ui-t1">Set a new password</h1>
        <p className="text-[15px]" style={{ color: "var(--mu)" }}>
          At least {PASSWORD_MIN} characters.
        </p>
      </div>
      <div className="flex flex-col gap-4">
        <div>
          <label className="ui-lbl" htmlFor="reset-password">
            New password
          </label>
          <div className="relative">
            <input
              id="reset-password"
              type={show ? "text" : "password"}
              required
              minLength={PASSWORD_MIN}
              autoComplete="new-password"
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
        </div>
        <div>
          <label className="ui-lbl" htmlFor="reset-confirm">
            Confirm new password
          </label>
          <input
            id="reset-confirm"
            type={show ? "text" : "password"}
            required
            minLength={PASSWORD_MIN}
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="ui-inp"
          />
        </div>
        <button type="submit" disabled={state === "saving"} className={primaryWide}>
          {state === "saving" ? "Saving..." : "Set new password"}
        </button>
      </div>
      {error && (
        <p role="alert" className="text-sm" style={{ color: "var(--rd)" }}>
          {AUTH_ERRORS[error]}
        </p>
      )}
    </form>
  );
}
