"use client";

// Narrow capture side panel (BUILD_SPEC D1): no avatar, just a small voice presence and controls.
import { useState, type FormEvent } from "react";
import type { ScreenEvent } from "@/lib/types";
import { eventText } from "@/lib/capture/eventText";

export type PresenceStatus = "idle" | "listening" | "thinking" | "speaking" | "paused";

export type SidePanelProps = {
  status: PresenceStatus;
  running: boolean;
  starting: boolean;
  offRecord: boolean;
  textMode: boolean;
  sharing: boolean;
  notice: string | null;
  /** 429 daily_limit from vision or decide. */
  limitNotice?: string | null;
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
  /** The capture console on the left owns the session controls, counter, last question and feed. */
  hideControls?: boolean;
};

const DOT: Record<PresenceStatus, string> = {
  idle: "bg-[var(--s3)]",
  listening: "bg-[var(--gr)]",
  thinking: "bg-[var(--am)] animate-pulse",
  speaking: "bg-[var(--ac)] animate-pulse",
  paused: "bg-[var(--rd)]",
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
    <aside
      className={p.hideControls ? "flex flex-col gap-3 text-sm" : "flex w-80 shrink-0 flex-col gap-3 border-l border-line bg-panel p-3 text-sm"}
      data-testid="side-panel"
    >
      {(p.running || !p.hideControls) && (
      <div className="flex items-center gap-2">
        <span data-testid="presence" className={`h-3 w-3 rounded-full ${DOT[p.status]}`} />
        <span className="font-medium capitalize">{p.status}</span>
        {p.running && <span className="ml-auto text-xs text-muted">{p.textMode ? "text mode" : "voice"}</span>}
      </div>
      )}

      {p.offRecord && (
        <div role="status" className="ui-bdg ui-k-rd self-start">
          Off the record · nothing is captured
        </div>
      )}

      {p.limitNotice && (
        <div role="alert" data-testid="daily-limit" className="rounded-xl bg-[var(--rds)] p-3 text-xs text-[var(--rd)]">
          {p.limitNotice}
        </div>
      )}

      {p.notice && <div className="rounded-xl bg-[var(--ams)] p-3 text-xs text-[var(--am)]">{p.notice}</div>}

      {!p.hideControls && (
        <>
      {!p.running ? (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1 text-xs text-muted">
            Expert
            <input
              className="ui-inp"
              value={p.expert}
              onChange={(e) => p.onExpertChange(e.target.value)}
            />
          </label>
          <button
            type="button"
            disabled={p.starting}
            onClick={p.onStart}
            className="ui-btn ui-bp"
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
              className={`flex-1 rounded border px-2 py-1 text-xs ${p.sharing ? "border-[var(--ac)] bg-[var(--acs)]" : "border-line"}`}
            >
              {p.sharing ? "Stop sharing" : "Share screen"}
            </button>
            <button type="button" onClick={p.onEnd} className="ui-btn ui-bs ui-bsm flex-1">
              End task
            </button>
          </div>
        </>
      )}

      <div className="text-xs text-muted">
        {p.asked} asked, {p.guardrailAsked} about guardrails
        {p.savedForDebrief ? `, ${p.savedForDebrief} saved for debrief` : ""}
      </div>

      <div>
        <div className="ui-eb">Last question</div>
        <div className="min-h-10 rounded-xl bg-[var(--s2)] p-2">{p.lastQuestion ?? "None yet"}</div>
      </div>

        </>
      )}

      {p.running && p.textMode && (
        <form onSubmit={submit} className="flex flex-col gap-1">
          <label className="ui-eb" htmlFor="capture-answer">
            {p.openQuestion ? "Your answer" : "Say something"}
          </label>
          <div className="flex gap-1">
            <input
              id="capture-answer"
              className="ui-inp min-w-0 flex-1"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              placeholder="Type, or 'off the record'"
            />
            <button type="submit" className="ui-btn ui-bp">
              Send
            </button>
          </div>
        </form>
      )}

      {!p.hideControls && (
      <div className="min-h-0 flex-1">
        <div className="ui-eb">Events</div>
        <ol className="flex flex-col gap-1 font-mono text-xs">
          {p.feed.length === 0 && <li className="text-muted">No events yet</li>}
          {p.feed.map((e) => (
            <li key={e.id} className="border-b border-line pb-1">
              {mmss(e.t)} {eventText(e, p.feed).text}{e.chord && ` · ${e.chord}`}
            </li>
          ))}
        </ol>
      </div>
      )}
    </aside>
  );
}
