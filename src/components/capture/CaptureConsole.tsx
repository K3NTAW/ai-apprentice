"use client";

// Capture session console, 1:1 with docs/design/canvas/Capture.dc.html (pivot: Capture watches the expert's real
// screen, any app): controls, last question, live events, questions so far, the app status (no pairing card: the
// canvas pairing digits are obsolete) and the whole-screen share card.
import type { ScreenEvent } from "@/lib/types";
import { describeEvent } from "@/lib/voice/prompts";
import type { TransportHost } from "@/lib/companion/transport";
import type { CompanionCardProps } from "./CompanionCard";
import CompanionSlot, { AppStatus } from "./DesktopPanel";
import { buttonClass, Card } from "@/components/ui";

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

const stat = (n: number, label: string) => (
  <div style={{ padding: 12, borderRadius: 12, background: "var(--s2)" }}>
    <div className="ui-mono ui-t3">{n}</div>
    <div className="text-xs" style={{ color: "var(--fa)" }}>
      {label}
    </div>
  </div>
);

export default function CaptureConsole(p: CaptureConsoleProps) {
  const host = p.host ?? "websocket";
  return (
    <div className="flex min-w-0 flex-col" style={{ padding: "28px 40px 56px", gap: 22 }} data-testid="capture-console">
      <div className="flex flex-wrap items-end justify-between" style={{ gap: 16 }}>
        <div className="flex flex-col" style={{ gap: 6 }}>
          <span className="text-[13px]" style={{ color: "var(--mu)" }}>
            Agents / Train
          </span>
          <div className="flex flex-wrap items-center" style={{ gap: 12 }}>
            <h1 className="ui-t1">Capture</h1>
            {p.running &&
              (p.offRecord ? (
                <span className="ui-bdg ui-k-pend">Off the record</span>
              ) : (
                <span className="ui-bdg ui-k-rd" style={{ gap: 8 }} data-testid="capturing">
                  <span className="ui-rec" />
                  Capturing
                </span>
              ))}
          </div>
          <label className="flex items-center" style={{ gap: 8, color: "var(--mu)" }}>
            Expert
            <input
              className="ui-inp"
              style={{ width: 220, height: 32 }}
              value={p.expert}
              disabled={p.running}
              onChange={(e) => p.onExpertChange(e.target.value)}
            />
          </label>
        </div>
        <div className="flex flex-wrap" style={{ gap: 8 }} role="group" aria-label="Capture controls">
          <button type="button" disabled={p.running || p.starting} onClick={p.onStart} className={buttonClass(p.running ? "secondary" : "primary")}>
            {p.starting ? "Starting..." : "Start"}
          </button>
          <button type="button" disabled={!p.running} onClick={p.onToggleShare} className={buttonClass("secondary")}>
            {p.sharing ? "Stop sharing" : "Share screen"}
          </button>
          <button type="button" disabled={!p.running} onClick={p.onTogglePause} className={buttonClass("secondary")}>
            {p.offRecord ? "Back on the record" : "Pause / off the record"}
          </button>
          <button type="button" disabled={!p.running} onClick={p.onEnd} className={buttonClass("primary")}>
            End task
          </button>
        </div>
      </div>
      {p.shareWarning && (
        <p role="alert" data-testid="share-warning" className="text-[13px]" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--ams)", color: "var(--am)" }}>
          {p.shareWarning}
        </p>
      )}

      <div className="flex flex-wrap items-start" style={{ gap: 20 }}>
        <div className="flex min-w-0 flex-col" style={{ flex: "3 1 560px", gap: 20 }}>
          <Card className="flex flex-col" style={{ padding: 24, gap: 12, background: "var(--stage)" }}>
            <span className="ui-eb">Last question</span>
            <p className="ui-t2" data-testid="last-question">
              {p.lastQuestion ?? "None yet"}
            </p>
          </Card>

          <Card className="overflow-hidden" style={{ padding: 0 }}>
            <div className="flex flex-wrap items-center justify-between" style={{ padding: "16px 20px", gap: 12 }}>
              <h2 className="ui-t3">Live events</h2>
              <span className="text-xs" style={{ color: "var(--fa)" }}>
                Newest first · personal data is redacted before it is stored
              </span>
            </div>
            {p.feed.length === 0 && (
              <p className="text-[13px]" style={{ padding: "0 20px 16px", color: "var(--fa)" }}>
                No events yet
              </p>
            )}
            <ol className="m-0 list-none p-0">
              {p.feed.map((e) => (
                <li key={e.id} className="ui-ev">
                  <span className="ui-mono text-xs" style={{ color: "var(--fa)" }}>
                    {mmss(e.t)}
                  </span>
                  <span className="ui-app">
                    <i style={{ background: "var(--fa)" }} />
                    {e.app ?? e.source}
                  </span>
                  <span>{describeEvent(e)}</span>
                  <span />
                </li>
              ))}
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
            {p.savedForDebrief > 0 && (
              <div className="grid" style={{ gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 10 }}>
                {stat(p.savedForDebrief, "Saved for debrief")}
              </div>
            )}
          </Card>

          <Card className="flex flex-col" style={{ padding: 22, gap: 14 }}>
            <h2 className="ui-t3">Companion</h2>
            {host === "websocket" ? <AppStatus companion={p.companion} /> : <CompanionSlot host={host} companion={p.companion} />}
          </Card>

          <Card className="flex flex-col" style={{ padding: 22, gap: 14 }}>
            <div className="flex items-center justify-between" style={{ gap: 10 }}>
              <h2 className="ui-t3">Share entire screen</h2>
              {p.sharing && <span className="ui-bdg ui-k-ac">Sharing</span>}
            </div>
            <span className="text-[13px]" style={{ color: "var(--mu)" }}>
              {SHARE_EXPLAINER}
            </span>
          </Card>
        </div>
      </div>
    </div>
  );
}
