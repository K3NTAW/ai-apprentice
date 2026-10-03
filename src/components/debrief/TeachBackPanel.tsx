"use client";

// Teach-back text with its spoken length estimate, and the explicit confirm / correct buttons (always visible).
import { useState } from "react";
import { spokenSeconds } from "@/lib/debrief/controller";

export type TeachBackPanelProps = {
  text: string;
  corrected: boolean;
  confirmed: boolean;
  busy: boolean;
  awaitingCorrection: boolean;
  onResult(result: { confirmed: boolean; correction?: string }): void;
};

export default function TeachBackPanel({ text, corrected, confirmed, busy, awaitingCorrection, onResult }: TeachBackPanelProps) {
  const [open, setOpen] = useState(false);
  const [correction, setCorrection] = useState("");
  const secs = spokenSeconds(text);
  const underMinute = secs < 60;
  const showInput = open || awaitingCorrection;

  return (
    <section className="flex flex-col gap-3 rounded border border-slate-200 p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">{corrected ? "Teach-back (after your correction)" : "Teach-back"}</h2>
        <span
          className={`rounded px-2 py-0.5 font-mono text-xs ${underMinute ? "bg-green-100 text-green-800" : "bg-red-100 text-red-800"}`}
          title="spoken length estimate: words / 2.5 per second"
        >
          ~{secs.toFixed(0)} s spoken {underMinute ? "(under 60 s)" : "(over 60 s)"}
        </span>
      </div>
      <p className="text-sm leading-relaxed">{text}</p>
      {!confirmed && (
        <div className="flex flex-col gap-2">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={() => onResult({ confirmed: true })}
              className="rounded bg-green-700 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              Yes, that is how it works
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(true)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Not quite
            </button>
          </div>
          {showInput && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!correction.trim()) return;
                onResult({ confirmed: false, correction });
                setCorrection("");
                setOpen(false);
              }}
            >
              <input
                autoFocus
                value={correction}
                onChange={(e) => setCorrection(e.target.value)}
                placeholder="What did I get wrong?"
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <button
                type="submit"
                disabled={busy || !correction.trim()}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Send correction
              </button>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
