"use client";

// Teach-back card (canvas Debrief.dc.html): text with its spoken length estimate, and the explicit confirm / correct buttons (always visible).
import { useState } from "react";
import { buttonClass } from "@/components/ui";
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
    <section className="ui-card flex flex-col" style={{ padding: 28, gap: 18 }} data-testid="teach-back">
      <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
        <span className="ui-eb">{corrected ? "Teach-back (after your correction)" : "Teach-back"}</span>
        <span
          className={`ui-bdg ui-mono ${underMinute ? "ui-k-pend" : "ui-k-rd"}`}
          title="spoken length estimate: words / 2.5 per second"
        >
          ~{secs.toFixed(0)} s spoken {underMinute ? "(under 60 s)" : "(over 60 s)"}
        </span>
      </div>
      <p style={{ fontSize: 17, lineHeight: 1.65, maxWidth: "62ch" }}>{text}</p>
      {!confirmed && (
        <div className="flex flex-col" style={{ gap: 10 }}>
          <div className="flex flex-wrap" style={{ gap: 10, paddingTop: 4 }}>
            <button
              type="button"
              disabled={busy}
              onClick={() => onResult({ confirmed: true })}
              className={buttonClass("primary", "lg")}
            >
              Yes, that is how it works
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => setOpen(true)}
              className={buttonClass("secondary", "lg")}
            >
              Not quite
            </button>
          </div>
          <span className="text-xs" style={{ color: "var(--fa)" }}>
            &ldquo;Not quite&rdquo; lets you say what is wrong. The agent asks one more question and tries again.
          </span>
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
                className="ui-inp flex-1"
              />
              <button
                type="submit"
                disabled={busy || !correction.trim()}
                className={buttonClass("primary")}
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
