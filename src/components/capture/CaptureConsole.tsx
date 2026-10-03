"use client";

// Capture session console (pivot: Capture watches the expert's real screen, any app).
// Expert name, Start, Share screen, End task, Pause / off the record, the live feed, counter and last question.
import type { ScreenEvent } from "@/lib/types";
import { describeEvent } from "@/lib/voice/prompts";
import type { TransportHost } from "@/lib/companion/transport";
import type { CompanionCardProps } from "./CompanionCard";
import CompanionSlot from "./DesktopPanel";

export type CaptureConsoleProps = {
  running: boolean;
  starting: boolean;
  offRecord: boolean;
  sharing: boolean;
  /** Set when the shared surface is not the whole monitor. */
  shareWarning: string | null;
  expert: string;
  lastQuestion: string | null;
  asked: number;
  guardrailAsked: number;
  savedForDebrief: number;
  feed: ScreenEvent[];
  companion: CompanionCardProps;
  /** Which companion transport runs: bridge (desktop app), websocket (opt-in), none (browser), detecting. Default websocket. */
  host?: TransportHost;
  onExpertChange(name: string): void;
  onStart(): void;
  onEnd(): void;
  onTogglePause(): void;
  onToggleShare(): void;
};

export const SHARE_EXPLAINER =
  "Share your whole screen, not a window or tab: Capture follows your work across every app, and the halo is placed on the full display.";

function mmss(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function CaptureConsole(p: CaptureConsoleProps) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 text-sm">
      <h1 className="text-lg font-semibold">Capture</h1>

      <section className="flex flex-col gap-3 rounded border border-slate-200 bg-white p-3">
        <label className="flex flex-col gap-1 text-xs text-slate-600">
          Expert
          <input
            className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-900 disabled:bg-slate-50"
            value={p.expert}
            disabled={p.running}
            onChange={(e) => p.onExpertChange(e.target.value)}
          />
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={p.running || p.starting}
            onClick={p.onStart}
            className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50"
          >
            {p.starting ? "Starting..." : "Start"}
          </button>
          <button
            type="button"
            disabled={!p.running}
            onClick={p.onToggleShare}
            className={`rounded border px-3 py-2 disabled:opacity-50 ${p.sharing ? "border-blue-500 bg-blue-50" : "border-slate-300"}`}
          >
            {p.sharing ? "Stop sharing" : "Share screen"}
          </button>
          <button
            type="button"
            disabled={!p.running}
            onClick={p.onTogglePause}
            className={`rounded px-3 py-2 font-bold text-white disabled:opacity-50 ${p.offRecord ? "bg-green-600" : "bg-red-600"}`}
          >
            {p.offRecord ? "Back on the record" : "Pause / off the record"}
          </button>
          <button
            type="button"
            disabled={!p.running}
            onClick={p.onEnd}
            className="rounded border border-slate-300 px-3 py-2 disabled:opacity-50"
          >
            End task
          </button>
        </div>
        <p className="text-xs text-slate-500">{SHARE_EXPLAINER}</p>
        {p.shareWarning && (
          <p role="alert" data-testid="share-warning" className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
            {p.shareWarning}
          </p>
        )}
      </section>

      <CompanionSlot host={p.host ?? "websocket"} companion={p.companion} />

      <section className="flex flex-col gap-2 rounded border border-slate-200 bg-white p-3">
        <div data-testid="question-counter" className="text-xs text-slate-600">
          {p.asked} asked, {p.guardrailAsked} about guardrails
          {p.savedForDebrief ? `, ${p.savedForDebrief} saved for debrief` : ""}
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Last question</div>
          <div className="min-h-10 rounded bg-slate-50 p-2">{p.lastQuestion ?? "None yet"}</div>
        </div>
        <div>
          <div className="text-[11px] uppercase tracking-wide text-slate-500">Live events</div>
          <ol className="flex flex-col gap-1 font-mono text-xs">
            {p.feed.length === 0 && <li className="text-slate-400">No events yet</li>}
            {p.feed.map((e) => (
              <li key={e.id} className="border-b border-slate-100 pb-1">
                {mmss(e.t)} {describeEvent(e)}
              </li>
            ))}
          </ol>
        </div>
      </section>
    </div>
  );
}
