"use client";

// 'Desktop companion' card in the capture console: status, missing macOS permissions, pairing code input.
import { useState, type FormEvent } from "react";
import type { CompanionPermissions, CompanionStatus } from "@/lib/companion/client";

export const COMPANION_README = "https://github.com/K3NTAW/ai-apprentice/blob/main/companion/README.md";

export type CompanionCardProps = {
  status: CompanionStatus;
  permissions: CompanionPermissions | null;
  /** Returns false when the code is not 6 digits. */
  onPair(code: string): boolean;
};

const LABEL: Record<CompanionStatus, string> = {
  "not connected": "Not running or not reachable from this browser",
  connecting: "Connecting...",
  pair: "Pair: enter the code from the companion's tray menu",
  paired: "Paired",
  "origin blocked": "This site is not on the companion's allowed origins",
};

const PERMISSION_NAMES: Record<keyof CompanionPermissions, string> = {
  input: "Input Monitoring",
  screen: "Screen Recording",
  accessibility: "Accessibility",
};

export function missingPermissions(p: CompanionPermissions | null): string[] {
  if (!p) return [];
  return (Object.keys(PERMISSION_NAMES) as (keyof CompanionPermissions)[]).filter((k) => !p[k]).map((k) => PERMISSION_NAMES[k]);
}

export default function CompanionCard({ status, permissions, onPair }: CompanionCardProps) {
  const [code, setCode] = useState("");
  const [bad, setBad] = useState(false);
  const missing = status === "paired" ? missingPermissions(permissions) : [];

  function submit(e: FormEvent) {
    e.preventDefault();
    const ok = onPair(code);
    setBad(!ok);
    if (ok) setCode("");
  }

  return (
    <section data-testid="companion-card" className="flex flex-col gap-2 rounded border border-slate-200 bg-white p-3 text-xs">
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full ${status === "paired" ? "bg-green-500" : "bg-slate-300"}`} />
        <h3 className="font-semibold">Desktop companion</h3>
        <span data-testid="companion-status" className="ml-auto text-slate-600">
          {LABEL[status]}
        </span>
      </div>
      {status === "not connected" && (
        <p className="text-slate-500">
          Start the companion app. Safari blocks the local connection from an https page and Chrome may ask to allow local
          network access. Without it, Capture uses speech pauses and screen stillness.
        </p>
      )}
      {missing.length > 0 && (
        <p role="alert" className="text-amber-800">
          Missing macOS permissions: {missing.join(", ")}. Grant them in System Settings, Privacy &amp; Security.
        </p>
      )}
      {status !== "paired" && (
        <form onSubmit={submit} className="flex gap-1">
          <input
            aria-label="Pairing code"
            inputMode="numeric"
            autoComplete="off"
            maxLength={6}
            placeholder="6-digit code"
            className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
          <button type="submit" className="rounded bg-slate-900 px-2 py-1 text-white">
            Pair
          </button>
        </form>
      )}
      {bad && <p className="text-red-700">The code has 6 digits.</p>}
      <a href={COMPANION_README} target="_blank" rel="noreferrer" className="text-blue-700 underline">
        Install the companion (companion/README)
      </a>
    </section>
  );
}
