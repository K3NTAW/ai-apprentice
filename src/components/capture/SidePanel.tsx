"use client";

// Narrow capture side panel (BUILD_SPEC D1): no avatar, just a small voice presence and controls.
import { useState, type FormEvent } from "react";
import type { ScreenEvent } from "@/lib/types";
import { describeEvent } from "@/lib/voice/prompts";

export type PresenceStatus = "idle" | "listening" | "thinking" | "speaking" | "paused";

export type SidePanelProps = {
  status: PresenceStatus;
  running: boolean;
  starting: boolean;
  offRecord: boolean;
  textMode: boolean;
  sharing: boolean;
  notice: string | null;
  expert: string;
  lastQuestion: string | null;
  openQuestion: string | null;
  asked: number;
  guardrailAsked: number;
  savedForDebrief: number;
  feed: ScreenEvent[];
  onExpertChange(name: string): void;
  onStart(): void;
  onEnd(): void;
  onTogglePause(): void;
  onToggleShare(): void;
  onAnswer(text: string): void;
};

const DOT: Record<PresenceStatus, string> = {
  idle: "bg-slate-300",
  listening: "bg-green-500",
  thinking: "bg-amber-400 animate-pulse",
  speaking: "bg-blue-500 animate-pulse",
  paused: "bg-red-500",
};

function mmss(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

export default function SidePanel(p: SidePanelProps) {
  const [answer, setAnswer] = useState("");

  function submit(e: FormEvent) {
    e.preventDefault();
    const text = answer.trim();
    if (!text) return;
    p.onAnswer(text);
    setAnswer("");
  }

  return (
    <aside className="flex w-80 shrink-0 flex-col gap-3 border-l border-slate-300 bg-white p-3 text-sm">
      <div className="flex items-center gap-2">
        <span data-testid="presence" className={`h-3 w-3 rounded-full ${DOT[p.status]}`} />
        <span className="font-medium capitalize">{p.status}</span>
        {p.running && <span className="ml-auto text-xs text-slate-500">{p.textMode ? "text mode" : "voice"}</span>}
      </div>

      {p.offRecord && (
        <div role="status" className="rounded bg-red-600 px-2 py-2 text-center text-xs font-bold text-white">
          OFF THE RECORD - nothing is captured
        </div>
      )}

      {p.notice && <div className="rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">{p.notice}</div>}

      {!p.running ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-slate-600">
            Expert
            <input
              className="rounded border border-slate-300 px-2 py-1 text-sm text-slate-900"
              value={p.expert}
              onChange={(e) => p.onExpertChange(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={p.starting}
            onClick={p.onStart}
            className="rounded bg-slate-900 px-3 py-2 font-medium text-white disabled:opacity-50"
          >
            {p.starting ? "Starting..." : "Start session"}
          </button>
        </div>
      ) : (
        <>
          <button
            type="button"
            onClick={p.onTogglePause}
            className={`rounded px-3 py-4 text-lg font-bold text-white ${p.offRecord ? "bg-green-600" : "bg-red-600"}`}
          >
            {p.offRecord ? "Resume" : "Pause"}
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={p.onToggleShare}
              className={`flex-1 rounded border px-2 py-1 text-xs ${p.sharing ? "border-blue-500 bg-blue-50" : "border-slate-300"}`}
            >
              {p.sharing ? "Stop sharing" : "Share screen"}
            </button>
            <button type="button" onClick={p.onEnd} className="flex-1 rounded border border-slate-300 px-2 py-1 text-xs">
              End task
            </button>
          </div>
        </>
      )}

      <div className="text-xs text-slate-600">
        {p.asked} asked, {p.guardrailAsked} about guardrails
        {p.savedForDebrief ? `, ${p.savedForDebrief} saved for debrief` : ""}
      </div>

      <div>
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Last question</div>
        <div className="min-h-10 rounded bg-slate-50 p-2">{p.lastQuestion ?? "None yet"}</div>
      </div>

      {p.running && p.textMode && (
        <form onSubmit={submit} className="flex flex-col gap-1">
          <label className="text-[11px] uppercase tracking-wide text-slate-500" htmlFor="capture-answer">
            {p.openQuestion ? "Your answer" : "Say something"}
          </label>
          <div className="flex gap-1">
            <input
              id="capture-answer"
              className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type, or 'off the record'"
            />
            <button type="submit" className="rounded bg-slate-900 px-2 py-1 text-xs text-white">
              Send
            </button>
          </div>
        </form>
      )}

      <div className="min-h-0 flex-1">
        <div className="text-[11px] uppercase tracking-wide text-slate-500">Events</div>
        <ol className="flex flex-col gap-1 font-mono text-xs">
          {p.feed.length === 0 && <li className="text-slate-400">No events yet</li>}
          {p.feed.map((e) => (
            <li key={e.id} className="border-b border-slate-100 pb-1">
              {mmss(e.t)} {describeEvent(e)}
            </li>
          ))}
        </ol>
      </div>
    </aside>
  );
}
