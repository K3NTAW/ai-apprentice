"use client";

import { useState, type FormEvent } from "react";
import { safeNext } from "@/lib/auth/redirect";
import { createSupabaseBrowserClient } from "@/lib/supabase/browser";

type State = "idle" | "sending" | "sent" | "error" | "rate_limited";

function isRateLimited(err: { status?: number; code?: string }): boolean {
  return err.status === 429 || err.code === "over_email_send_rate_limit";
}

export default function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<State>("idle");

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setState("sending");
    try {
      const supabase = createSupabaseBrowserClient();
      const emailRedirectTo = `${location.origin}/auth/callback?next=${encodeURIComponent(safeNext(next))}`;
      const { error } = await supabase.auth.signInWithOtp({ email: email.trim(), options: { emailRedirectTo } });
      if (!error) setState("sent");
      else setState(isRateLimited(error) ? "rate_limited" : "error");
    } catch {
      setState("error");
    }
  }

  if (state === "sent") {
    return <p>Check your inbox. The link signs you in on this browser.</p>;
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-2">
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
        {state === "sending" ? "Sending..." : "Send sign-in link"}
      </button>
      {state === "error" && (
        <p role="alert" className="text-red-700">
          The link could not be sent. Try again.
        </p>
      )}
      {state === "rate_limited" && (
        <p role="alert" className="text-red-700">
          Too many sign-in links were requested. Wait a few minutes, then try again.
        </p>
      )}
    </form>
  );
}
