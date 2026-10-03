"use client";

// Teach console (presentational): Work Map picker, controls, companion pairing (the Capture card),
// current step, tutor transcript, the active stop with the expert's moment, and the mastery result.
import CompanionCard, { type CompanionCardProps } from "@/components/capture/CompanionCard";
import type { Intervention, InterventionStats } from "@/lib/teach/intervention";
import type { MasterySummary } from "@/lib/teach/mastery";
import type { WorkMap, WorkMapStep } from "@/lib/types";
import type { PickerOption } from "./loadWorkMap";

export type TeachLine = { id: string; speaker: "tutor" | "learner"; text: string };

export type TeachConsoleProps = {
  options: PickerOption[];
  selected: string | null;
  workmap: WorkMap | null;
  banner: string | null;
  /** Session id of the chosen Work Map; frames of the expert's moment load from it. */
  workmapSessionId: string | null;
  running: boolean;
  starting: boolean;
  paused: boolean;
  sharing: boolean;
  shareWarning: string | null;
  notice: string | null;
  textMode: boolean;
  companion: CompanionCardProps;
  currentStep: WorkMapStep | null;
  transcript: TeachLine[];
  intervention: Intervention | null;
  replayOpen: boolean;
  stats: InterventionStats;
  result: (MasterySummary & { saved: string }) | null;
  onSelect(id: string): void;
  onStart(): void;
  onToggleShare(): void;
  onTogglePause(): void;
  onEnd(): void;
  onReplay(): void;
  onAnswer(text: string): void;
};

const btn = "rounded border border-slate-300 bg-white px-3 py-1 text-sm disabled:opacity-50";

export function frameUrl(sessionId: string | null, frameRef: string | undefined): string | null {
  if (!sessionId || !frameRef || !/^frames\/[\w.-]+$/.test(frameRef)) return null;
  return `/api/session/${encodeURIComponent(sessionId)}/${frameRef}`;
}

export function decideStatus(s: InterventionStats): string {
  const base = `${s.interventions} stops, ${s.decideCalls} checks`;
  if (s.capped) return `${base}. Guardrail checks paused: usage cap reached.`;
  if (s.decideFailures) return `${base}, ${s.decideFailures} failed (${s.lastDecideError ?? "error"}): no stop on a failed check.`;
  return base;
}

export default function TeachConsole(p: TeachConsoleProps) {
  const iv = p.intervention;
  const img = iv ? frameUrl(p.workmapSessionId, iv.replay.frame_ref) : null;
  return (
    <main className="flex flex-col gap-4 p-6" data-testid="teach-console">
      <h1 className="text-lg font-semibold">Teach</h1>
      <section className="flex flex-wrap items-center gap-2">
        <label className="text-sm">
          Work Map{" "}
          <select
            aria-label="Work Map"
            className="rounded border border-slate-300 px-2 py-1"
            value={p.selected ?? ""}
            disabled={p.running}
            onChange={(e) => p.onSelect(e.target.value)}
          >
            {p.options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <button className={btn} disabled={p.running || p.starting || !p.workmap} onClick={p.onStart}>
          Start
        </button>
        <button className={btn} disabled={!p.running} onClick={p.onToggleShare}>
          {p.sharing ? "Stop sharing" : "Share screen"}
        </button>
        <button className={btn} disabled={!p.running} onClick={p.onTogglePause}>
          {p.paused ? "Resume" : "Pause"}
        </button>
        <button className={btn} disabled={!p.running} onClick={p.onEnd}>
          Finish
        </button>
      </section>
      {p.banner && <p className="text-xs text-slate-500">{p.banner}</p>}
      <p className="text-xs text-slate-500">Share the whole screen: the tutor watches your real apps and stops a risky change before you save it.</p>
      {p.shareWarning && <p className="text-sm text-amber-700">{p.shareWarning}</p>}
      {p.notice && <p className="text-sm text-amber-700">{p.notice}</p>}
      <CompanionCard {...p.companion} />
      {p.companion.status !== "paired" && (
        <p className="text-xs text-slate-500">Companion not paired: the tutor stops by voice only, no halo over the app.</p>
      )}

      <section className="rounded border border-slate-200 bg-white p-3" data-testid="current-step">
        <h2 className="text-sm font-semibold">Current step</h2>
        {p.currentStep ? (
          <p className="text-sm">
            Step {p.currentStep.n}: {p.currentStep.title}
          </p>
        ) : (
          <p className="text-sm text-slate-500">Waiting for the first step of {p.workmap?.task ?? "the Work Map"}.</p>
        )}
        <p className="text-xs text-slate-500">{decideStatus(p.stats)}</p>
      </section>

      {iv && (
        <section className="rounded border border-red-300 bg-red-50 p-3" data-testid="intervention">
          <p className="text-sm font-semibold">{iv.say}</p>
          <blockquote className="text-sm italic">&ldquo;{iv.quote}&rdquo;</blockquote>
          {iv.notice && <p className="text-xs text-amber-700">{iv.notice}</p>}
          <button className={btn} onClick={p.onReplay}>
            Replay {iv.expert}&apos;s moment
          </button>
          {p.replayOpen && (
            <figure className="mt-2" data-testid="replay">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {img ? <img src={img} alt={`${iv.expert}'s screen at step ${iv.step.n}`} className="max-w-md rounded border" /> : <p className="text-xs text-slate-500">No frame stored for this moment.</p>}
              <figcaption className="text-sm">
                {iv.expert}: &ldquo;{iv.replay.quote}&rdquo;
              </figcaption>
            </figure>
          )}
        </section>
      )}

      <section className="rounded border border-slate-200 bg-white p-3">
        <h2 className="text-sm font-semibold">Tutor</h2>
        <ul className="flex flex-col gap-1 text-sm">
          {p.transcript.map((l) => (
            <li key={l.id}>
              <span className="font-medium">{l.speaker === "tutor" ? "Tutor" : "You"}:</span> {l.text}
            </li>
          ))}
        </ul>
        {p.textMode && p.running && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const input = e.currentTarget.elements.namedItem("answer") as HTMLInputElement;
              if (input.value.trim()) p.onAnswer(input.value.trim());
              input.value = "";
            }}
          >
            <input name="answer" aria-label="Your answer" className="mt-2 w-full rounded border border-slate-300 px-2 py-1 text-sm" />
          </form>
        )}
      </section>

      {p.result && (
        <section className="rounded border border-emerald-300 bg-emerald-50 p-3" data-testid="mastery">
          <h2 className="text-sm font-semibold">Mastered</h2>
          <p className="text-sm">{p.result.mastered.join(", ") || "Nothing yet"}</p>
          <h2 className="text-sm font-semibold">Practice next</h2>
          <p className="text-sm">{p.result.practice.join(", ") || "Nothing"}</p>
          <p className="text-xs text-slate-500">{p.result.saved}</p>
        </section>
      )}
    </main>
  );
}
