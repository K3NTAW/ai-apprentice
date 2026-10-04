"use client";

// Capture session console, 1:1 with docs/design/canvas/Capture.dc.html (pivot: Capture watches the expert's real
// screen, any app). Header: breadcrumb, 'Training <agent>' with the capturing pill, task and expert, the controls.
// Left: last question (question, the expert's answer in the serif quote box, chips) and the live events table.
// Right: questions so far, the app status (no pairing card: the canvas pairing digits are obsolete) and the screen card.
// Canvas data the session does not have (task, answer, chips, next-question timer) is hidden, never invented.
import type { ReactNode } from "react";
import type { ScreenEvent } from "@/lib/types";
import { describeEvent } from "@/lib/voice/prompts";
import type { TransportHost } from "@/lib/companion/transport";
import type { CompanionCardProps } from "./CompanionCard";
import CompanionSlot from "./DesktopPanel";
import { Badge, buttonClass, Card, Chord, FeedRow, type BadgeKind } from "@/components/ui";

export type LastAnswer = { expert: string; text: string; seconds?: number };
export type AnswerChip = { kind: BadgeKind; label: string };

export type CaptureConsoleProps = {
  running: boolean;
  starting: boolean;
  offRecord: boolean;
  /** Pause: the apprentice asks no live questions; capture, events and transcript continue. */
  questionsPaused?: boolean;
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
  /** Which companion transport runs: bridge (desktop app), websocket (opt-in), none (browser), detecting. Default bridge (design previews); the apps always pass it. */
  host?: TransportHost;
  /** The agent this session trains (?agent=<id>); without it the title reads 'Capture'. */
  agentName?: string | null;
  /** The agent's avatar, shown in the last question card. */
  avatar?: ReactNode;
  task?: string | null;
  /** Seconds since Start, for the capturing pill. */
  elapsed?: number;
  /** When the last question was asked, e.g. 'Asked at a pause, after Enter in Excel · 14:05:14'. */
  askedAt?: string | null;
  lastAnswer?: LastAnswer | null;
  answerChips?: AnswerChip[];
  /** Saved guardrails; the tile falls back to the questions asked about guardrails. */
  guardrails?: number;
  /** Seconds until the ask gate allows the next question. */
  nextQuestionIn?: number | null;
  /** Session notices, the text-mode answer form and the voice presence (rendered under the header). */
  children?: ReactNode;
  onExpertChange(name: string): void;
  onStart(): void;
  onEnd(): void;
  /** Pause / Resume questions (holds the ask gate). */
  onTogglePause(): void;
  /** Off the record / Back on the record (stops all capture). */
  onToggleOffRecord(): void;
  onToggleShare(): void;
};

export const SHARE_EXPLAINER = "Share your whole screen, not a window or tab: Capture follows your work across every app.";

export function mmss(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function mss(t: number): string {
  const s = Math.max(0, Math.floor(t));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** App tag colours from the canvas event table; other apps get the faint tag. */
const APP_COLORS: [RegExp, string][] = [
  [/excel|sheets|numbers/i, "#3FCF8E"],
  [/outlook|mail/i, "#5CC8FF"],
  [/chrome|safari|firefox|edge|arc|browser/i, "#9D8CFF"],
  [/powerpoint|keynote|slides/i, "#FF8A65"],
  [/word|pages|docs/i, "var(--ac)"],
];

/** Short app tag as in the canvas table ('Excel', 'Outlook', 'Chrome'). */
export function appTag(app: string): string {
  return app.replace(/^(Microsoft|Google|Apple|Adobe)\s+/i, "");
}

export function appColor(app: string): string {
  return APP_COLORS.find(([re]) => re.test(app))?.[1] ?? "var(--fa)";
}

const KEY_GLYPHS: Record<string, string> = { cmd: "⌘", command: "⌘", meta: "⌘", shift: "⇧", alt: "⌥", option: "⌥", opt: "⌥", ctrl: "⌃", control: "⌃", enter: "↵", return: "↵" };

export function chordKeys(chord: string): string[] {
  return chord
    .split("+")
    .map((k) => k.trim())
    .filter(Boolean)
    .map((k) => KEY_GLYPHS[k.toLowerCase()] ?? k);
}

const REDACTED = /\[(?:[a-z ]*?)redacted\]|<redacted>/gi;

/** Event text with redaction markers as the striped 'name redacted' chip. */
function EventText({ text }: { text: string }) {
  const parts = text.split(REDACTED);
  if (parts.length === 1) return <span>{text}</span>;
  return (
    <span className="flex flex-wrap items-center" style={{ gap: 6 }}>
      {parts.map((part, i) => (
        <span key={i} className="contents">
          {part.trim() && <span>{part.trim()}</span>}
          {i < parts.length - 1 && (
            <span className="ui-red" data-testid="redacted">
              redacted
            </span>
          )}
        </span>
      ))}
    </span>
  );
}

const Icon = ({ d }: { d: string }) => (
  <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
    <path d={d} />
  </svg>
);

const tile = (n: number, label: string) => (
  <div style={{ padding: 12, borderRadius: 12, background: "var(--s2)" }}>
    <div className="ui-mono ui-t3">{n}</div>
    <div className="text-xs" style={{ color: "var(--fa)" }}>
      {label}
    </div>
  </div>
);

export default function CaptureConsole(p: CaptureConsoleProps) {
  const host = p.host ?? "bridge";
  const stepsSeen = p.feed.filter((e) => e.source !== "os").length;
  const shortcuts = p.feed.filter((e) => e.type === "shortcut_used").length;
  const crumb = p.agentName ? `Agents / ${p.agentName} / Train` : "Agents / Train";
  return (
    <div className="flex min-w-0 flex-col" style={{ padding: "28px 40px 56px", gap: 22 }} data-testid="capture-console">
      <div className="flex flex-wrap items-end justify-between" style={{ gap: 16 }}>
        <div className="flex flex-col" style={{ gap: 6 }}>
          <span className="text-[13px]" style={{ color: "var(--mu)" }}>
            {crumb}
          </span>
          <div className="flex flex-wrap items-center" style={{ gap: 12 }}>
            <h1 className="ui-t1" style={{ fontSize: 32 }}>{p.agentName ? `Training ${p.agentName}` : "Capture"}</h1>
            {p.running &&
              (p.offRecord ? (
                <span className="ui-bdg ui-k-pend">Off the record</span>
              ) : (
                <span className="ui-bdg ui-bdg-nd ui-k-rd" style={{ gap: 8 }} data-testid="capturing">
                  <span className="ui-rec" />
                  Capturing{p.elapsed !== undefined && (
                    <>
                      {" · "}
                      <span className="ui-mono">{mmss(p.elapsed)}</span>
                    </>
                  )}
                </span>
              ))}
            {p.running && !p.offRecord && p.questionsPaused && (
              <span className="ui-bdg ui-k-pend" data-testid="questions-paused">
                Questions paused
              </span>
            )}
          </div>
          {p.running ? (
            <span data-testid="capture-subtitle" style={{ color: "var(--mu)" }}>
              {p.task ? `Task: ${p.task} · ` : ""}
              {p.expert}
            </span>
          ) : (
            <label className="flex items-center" style={{ gap: 8, color: "var(--mu)" }}>
              {p.task ? `Task: ${p.task} · Expert` : "Expert"}
              <input className="ui-inp" style={{ width: 220, height: 32 }} value={p.expert} onChange={(e) => p.onExpertChange(e.target.value)} />
            </label>
          )}
        </div>
        <div className="flex flex-wrap" style={{ gap: 8 }} role="group" aria-label="Capture controls">
          <button type="button" disabled={p.running || p.starting} onClick={p.onStart} className={buttonClass(p.running ? "secondary" : "primary")}>
            <Icon d="M8 5v14l11-7z" />
            {p.starting ? "Starting..." : "Start"}
          </button>
          <button type="button" disabled={!p.running || p.offRecord} onClick={p.onTogglePause} className={buttonClass("secondary")}>
            <Icon d={p.questionsPaused ? "M8 5v14l11-7z" : "M9 5v14M15 5v14"} />
            {p.questionsPaused ? "Resume questions" : "Pause"}
          </button>
          <button type="button" disabled={!p.running} onClick={p.onToggleOffRecord} className={buttonClass("secondary")}>
            <Icon d="M3 3l18 18M10.6 6.1A10 10 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3 3.5M6.6 6.6C4.2 8.2 3 12 3 12s4 6 9 6c1.6 0 3-.4 4.3-1" />
            {p.offRecord ? "Back on the record" : "Off the record"}
          </button>
          <button type="button" disabled={!p.running} onClick={p.onEnd} className={buttonClass(p.running ? "primary" : "secondary")}>
            <Icon d="M8 6h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z" />
            End task
          </button>
        </div>
      </div>
      {p.shareWarning && (
        <p role="alert" data-testid="share-warning" className="text-[13px]" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--ams)", color: "var(--am)" }}>
          {p.shareWarning}
        </p>
      )}
      {p.children}

      <div className="flex flex-wrap items-start" style={{ gap: 20 }}>
        <div className="flex min-w-0 flex-col" style={{ flex: "3 1 560px", gap: 20 }}>
          <Card className="flex flex-wrap items-start" style={{ padding: 24, gap: 22, background: "var(--stage)" }}>
            {p.avatar}
            <div className="flex flex-col" style={{ flex: 1, minWidth: 280, gap: 12 }} data-testid="last-question-card">
              <div className="flex flex-wrap justify-between" style={{ gap: 12 }}>
                <span className="ui-eb">Last question</span>
                {p.askedAt && (
                  <span className="text-xs" style={{ color: "var(--fa)" }}>
                    {p.askedAt}
                  </span>
                )}
              </div>
              <p className="ui-t2" style={{ fontSize: 22, lineHeight: 1.25 }} data-testid="last-question">
                {p.lastQuestion ?? "None yet"}
              </p>
              {p.lastAnswer && (
                <div className="ui-bub self-start" style={{ borderRadius: "18px 18px 6px 18px", background: "var(--s1)" }} data-testid="last-answer">
                  <span className="block text-xs" style={{ color: "var(--mu)", marginBottom: 2 }}>
                    {p.lastAnswer.expert}
                    {p.lastAnswer.seconds !== undefined && ` · ${p.lastAnswer.seconds} s`}
                  </span>
                  <span className="ui-qs" style={{ fontSize: 19, lineHeight: 1.25 }}>
                    {p.lastAnswer.text}
                  </span>
                </div>
              )}
              {p.answerChips && p.answerChips.length > 0 && (
                <div className="flex flex-wrap" style={{ gap: 8 }}>
                  {p.answerChips.map((c) => (
                    <Badge key={c.label} kind={c.kind}>
                      {c.label}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </Card>

          <Card className="overflow-hidden" style={{ padding: 0 }}>
            <div className="flex flex-wrap items-center justify-between" style={{ padding: "16px 20px", gap: 12 }}>
              <h2 className="ui-t3">Live events</h2>
              <span className="text-xs" style={{ color: "var(--fa)" }}>
                Newest first · personal data is redacted before it is stored
              </span>
            </div>
            {p.running && p.offRecord && (
              <FeedRow time="now" app="Companion" color="var(--fa)" muted trailing={<span className="ui-bdg ui-k-pend">Off the record</span>}>
                Off the record · nothing captured
              </FeedRow>
            )}
            {p.feed.length === 0 && !(p.running && p.offRecord) && (
              <p className="text-[13px]" style={{ padding: "0 20px 16px", color: "var(--fa)" }}>
                No events yet
              </p>
            )}
            <ol className="m-0 list-none p-0" data-testid="live-events">
              {p.feed.map((e) => {
                const app = e.app ?? e.source;
                return (
                  <li key={e.id}>
                    <FeedRow
                      time={mmss(e.t)}
                      app={appTag(app)}
                      color={appColor(app)}
                      trailing={e.type === "shortcut_used" && e.chord ? <Chord keys={chordKeys(e.chord)} /> : undefined}
                    >
                      <EventText text={describeEvent(e)} />
                    </FeedRow>
                  </li>
                );
              })}
            </ol>
          </Card>
        </div>

        <div className="flex min-w-0 flex-col" style={{ flex: "2 1 340px", gap: 20 }}>
          <Card className="flex flex-col" style={{ padding: 22, gap: 16 }}>
            <span className="ui-eb">Questions so far</span>
            <div data-testid="question-counter" className="flex flex-wrap items-baseline" style={{ gap: 10 }}>
              <span className="ui-mono" style={{ fontSize: 40, fontWeight: 600, letterSpacing: "-0.03em", lineHeight: 1 }}>
                {p.asked}
              </span>
              <span className="ui-t3" style={{ fontWeight: 500 }}>
                asked · <span style={{ color: "var(--co)" }}>{p.guardrailAsked} about guardrails</span>
              </span>
            </div>
            <div className="grid" style={{ gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }} data-testid="question-tiles">
              {tile(stepsSeen, "Steps seen")}
              {tile(shortcuts, "Shortcuts")}
              {tile(p.guardrails ?? p.guardrailAsked, "Guardrails")}
              {tile(p.savedForDebrief, "Saved for debrief")}
            </div>
            {p.nextQuestionIn != null && (
              <div className="flex items-center text-[13px]" style={{ gap: 8, color: "var(--mu)" }}>
                <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: 16, height: 16 }} aria-hidden="true">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
                <span>
                  Next question allowed in{" "}
                  <span className="ui-mono" style={{ color: "var(--tx)" }}>
                    {mss(p.nextQuestionIn)}
                  </span>
                  , at the next pause
                </span>
              </div>
            )}
          </Card>

          <CompanionSlot host={host} companion={p.companion} />

          <Card className="flex flex-col" style={{ padding: 22, gap: 14 }}>
            <div className="flex items-center justify-between" style={{ gap: 10 }}>
              <h2 className="ui-t3">Share entire screen</h2>
              {p.sharing ? <span className="ui-bdg ui-k-ac">Sharing</span> : <span className="ui-bdg ui-k-pend">Not sharing</span>}
            </div>
            <div
              data-testid="screen-preview"
              style={{ aspectRatio: "16 / 10", maxWidth: "100%", borderRadius: 10, border: "1px solid var(--ln2)", background: p.sharing ? "var(--stage)" : "var(--s2)" }}
              className="flex items-center justify-center"
            >
              <svg className="ui-ic" viewBox="0 0 24 24" style={{ width: 28, height: 28, color: "var(--fa)" }} aria-hidden="true">
                <rect x="3" y="4" width="18" height="12" rx="2" />
                <path d="M8 20h8M12 16v4" />
              </svg>
            </div>
            <span className="text-[13px]" style={{ color: "var(--mu)" }}>
              {p.sharing ? "Whole screen · windows from all apps" : SHARE_EXPLAINER}
            </span>
            <div className="flex flex-wrap" style={{ gap: 8 }}>
              <button type="button" disabled={!p.running} onClick={p.onToggleShare} className={buttonClass(p.sharing ? "ghost" : "secondary", "sm")}>
                {p.sharing ? "Stop sharing" : "Share screen"}
              </button>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
