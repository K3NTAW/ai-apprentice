"use client";

// Teach console (presentational), 1:1 with docs/design/canvas/Teach.dc.html (live) and TeachSummary.dc.html (ended):
// header with controls, current step card with progress segments, the tutor transcript as a chat thread with a
// composer at the bottom (typed turns go to the tutor, see textTurn.ts), the expert's moment with the italic serif
// quote, the app status (no pairing card) and the session summary.
import type { CompanionCardProps } from "@/components/capture/CompanionCard";
import CompanionSlot, { AppStatus } from "@/components/capture/DesktopPanel";
import { Badge, Button, Card } from "@/components/ui";
import type { TransportHost } from "@/lib/companion/transport";
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
  /** Which companion transport runs: bridge (desktop app), websocket (opt-in), none (browser), detecting. Default websocket. */
  host?: TransportHost;
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
  /** Why typed turns cannot be sent now (tutor disconnected); the composer is disabled while set. */
  sendError?: string | null;
};

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

const ic = { width: 18, height: 18 };
const serifQuote = { fontFamily: "'Instrument Serif', Georgia, serif", fontStyle: "italic" as const };

/** Canvas .seg colours: done green, judgment-call done amber, current accent, upcoming s3. */
export function segColor(step: WorkMapStep, current: number | null): string {
  if (current === null || step.n > current) return "var(--s3)";
  if (step.n === current) return "var(--ac)";
  return step.is_judgment_call ? "var(--am)" : "var(--gr)";
}

/** Composer submit: trims, ignores empty input, clears the field after a send. */
export function submitComposer(input: { value: string }, onSend: (text: string) => void): boolean {
  const text = input.value.trim();
  if (!text) return false;
  onSend(text);
  input.value = "";
  return true;
}

export function ChatThread({ lines, intervention }: { lines: TeachLine[]; intervention: Intervention | null }) {
  return (
    <div className="flex flex-col" style={{ padding: "20px 22px", gap: 12 }} data-testid="chat-thread" role="log" aria-label="Tutor transcript">
      {lines.length === 0 && <p className="text-[13px]" style={{ color: "var(--fa)" }}>The tutor&apos;s questions and your answers appear here.</p>}
      {lines.map((l) =>
        l.speaker === "tutor" ? (
          <div key={l.id} className="ui-bub" data-speaker="tutor">
            <span className="block text-xs" style={{ color: "var(--mu)" }}>
              Tutor
            </span>
            {l.text}
          </div>
        ) : (
          <div
            key={l.id}
            className="ui-bub"
            data-speaker="learner"
            style={{ borderRadius: "22px 22px 6px 22px", background: "var(--s3)", color: "var(--tx)", alignSelf: "flex-end", padding: "10px 16px" }}
          >
            <span className="block text-xs" style={{ opacity: 0.75 }}>
              You
            </span>
            {l.text}
          </div>
        ),
      )}
      {intervention && (
        <div className="ui-bub" data-speaker="stop" style={{ padding: "10px 14px", borderRadius: 16, background: "var(--cos)" }}>
          <span className="block text-xs" style={{ color: "var(--co)" }}>
            Tutor · stop moment
          </span>
          {intervention.say}
        </div>
      )}
    </div>
  );
}

export function Composer({ enabled, error, onSend }: { enabled: boolean; error: string | null; onSend(text: string): void }) {
  return (
    <form
      data-testid="composer"
      onSubmit={(e) => {
        e.preventDefault();
        submitComposer(e.currentTarget.elements.namedItem("answer") as HTMLInputElement, onSend);
      }}
      className="flex flex-col"
      style={{ gap: 6, margin: "0 22px 20px" }}
    >
      <div
        className="flex items-center"
        style={{ marginTop: 6, borderRadius: 26, background: "var(--cmp)", border: "1px solid var(--ln2)", padding: "8px 8px 8px 16px", gap: 10 }}
      >
        <label htmlFor="teach-reply" className="sr-only">
          Answer the tutor
        </label>
        <input
          id="teach-reply"
          name="answer"
          type="text"
          autoComplete="off"
          disabled={!enabled}
          placeholder="Answer out loud, or type here"
          style={{ flex: 1, minWidth: 0, border: 0, background: "transparent", color: "var(--tx)", fontFamily: "inherit", fontSize: 15, height: 36, outline: "none" }}
        />
        <Button type="submit" aria-label="Send" disabled={!enabled} style={{ width: 36, height: 36, padding: 0 }}>
          <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M12 19V5M6 11l6-6 6 6" />
          </svg>
        </Button>
      </div>
      {error && (
        <p role="alert" className="text-xs" style={{ color: "var(--rd)" }}>
          {error}
        </p>
      )}
    </form>
  );
}

function Summary({ p }: { p: TeachConsoleProps }) {
  const r = p.result!;
  const total = p.workmap?.steps.length ?? r.mastered.length + r.practice.length;
  const nByTitle = new Map((p.workmap?.steps ?? []).map((s) => [s.title, s.n]));
  const row = (title: string) => (
    <div key={title} className="grid items-center" style={{ gridTemplateColumns: "28px minmax(0, 1fr)", gap: 12, padding: "12px 0", borderTop: "1px solid var(--ln)" }}>
      <span className="ui-mono text-[13px]" style={{ color: "var(--fa)" }}>
        {nByTitle.get(title) ?? ""}
      </span>
      <span style={{ fontWeight: 500 }}>{title}</span>
    </div>
  );
  const empty = (t: string) => <p className="text-[13px]" style={{ color: "var(--mu)" }}>{t}</p>;
  return (
    <section className="flex flex-col" style={{ gap: 22 }} data-testid="mastery">
      <Card className="flex flex-wrap items-center" style={{ padding: 32, gap: 28, background: "var(--stage)" }}>
        <div className="flex flex-col" style={{ flex: 1, minWidth: 300, gap: 8 }}>
          <span className="ui-eb">Session complete</span>
          <h1 className="ui-t1">
            Nice work. {r.mastered.length} of {total} steps mastered.
          </h1>
          <p style={{ color: "var(--mu)", fontSize: 15 }}>{r.saved}</p>
        </div>
      </Card>
      <div className="grid items-start" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 380px), 1fr))", gap: 16 }}>
        <Card className="flex flex-col" style={{ padding: 22, gap: 4 }}>
          <div className="flex items-center" style={{ gap: 10, marginBottom: 10 }}>
            <Badge kind="confirmed">Mastered</Badge>
            <span className="text-[13px]" style={{ color: "var(--mu)" }}>
              {r.mastered.length} steps
            </span>
          </div>
          {r.mastered.length ? r.mastered.map(row) : empty("Nothing yet")}
        </Card>
        <Card className="flex flex-col" style={{ padding: 22, gap: 4 }}>
          <div className="flex items-center" style={{ gap: 10, marginBottom: 10 }}>
            <Badge kind="judgment">Practice next</Badge>
            <span className="text-[13px]" style={{ color: "var(--mu)" }}>
              {r.practice.length} steps
            </span>
          </div>
          {r.practice.length ? r.practice.map(row) : empty("Nothing")}
        </Card>
      </div>
      <p className="text-[13px]" style={{ color: "var(--fa)" }}>
        The expert sees this summary on the agent&apos;s Learners tab. Off the record time is not part of it.
      </p>
    </section>
  );
}

export default function TeachConsole(p: TeachConsoleProps) {
  const iv = p.intervention;
  const img = iv ? frameUrl(p.workmapSessionId, iv.replay.frame_ref) : null;
  const host = p.host ?? "websocket";
  const steps = p.workmap?.steps ?? [];
  const cur = p.currentStep;
  const sendError = p.sendError ?? null;
  return (
    <main className="flex min-w-0 flex-col" style={{ padding: "28px 40px 56px", gap: 22 }} data-testid="teach-console">
      <div className="flex flex-wrap items-end justify-between" style={{ gap: 16 }}>
        <div className="flex flex-col" style={{ gap: 6 }}>
          <span className="text-[13px]" style={{ color: "var(--mu)" }}>
            Learn / Teach
          </span>
          <div className="flex flex-wrap items-center" style={{ gap: 12 }}>
            <h1 className="ui-t1">{p.workmap?.task ?? "Teach"}</h1>
            {p.running && (
              <span className="ui-bdg ui-k-ok" style={{ gap: 8 }} data-testid="live-badge">
                <span className="ui-rec" style={{ background: "var(--gr)" }} />
                {p.paused ? "Paused" : "Teaching on your screen"}
              </span>
            )}
          </div>
          {p.workmap && <span style={{ color: "var(--mu)" }}>Learning from {p.workmap.expert}</span>}
        </div>
        <div className="flex flex-wrap items-center" style={{ gap: 8 }}>
          <select
            aria-label="Work Map"
            className="ui-inp"
            style={{ width: "auto", height: 40 }}
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
          {!p.running && (
            <Button disabled={p.starting || !p.workmap} onClick={p.onStart}>
              Start
            </Button>
          )}
          <Button variant="secondary" disabled={!p.running} onClick={p.onToggleShare}>
            {p.sharing ? "Stop sharing" : "Share screen"}
          </Button>
          <Button variant="secondary" disabled={!p.running} onClick={p.onTogglePause}>
            <svg className="ui-ic" viewBox="0 0 24 24" style={ic} aria-hidden="true">
              <path d="M9 5v14M15 5v14" />
            </svg>
            {p.paused ? "Resume" : "Pause"}
          </Button>
          <Button disabled={!p.running} onClick={p.onEnd}>
            <svg className="ui-ic" viewBox="0 0 24 24" style={ic} aria-hidden="true">
              <rect x="6" y="6" width="12" height="12" rx="2" />
            </svg>
            Finish
          </Button>
        </div>
      </div>
      {p.banner && <p className="text-xs" style={{ color: "var(--mu)" }}>{p.banner}</p>}
      {p.shareWarning && <p className="text-[13px]" style={{ color: "var(--am)" }}>{p.shareWarning}</p>}
      {p.notice && <p className="text-[13px]" style={{ color: "var(--am)" }}>{p.notice}</p>}

      {p.result ? (
        <Summary p={p} />
      ) : (
        <div className="flex flex-wrap items-start" style={{ gap: 20 }}>
          <div className="flex min-w-0 flex-col" style={{ flex: "3 1 540px", gap: 20 }}>
            <Card className="flex flex-col" style={{ padding: "22px 24px", gap: 16 }}>
              <div data-testid="current-step" className="flex flex-col" style={{ gap: 16 }}>
                <div className="flex flex-wrap justify-between" style={{ gap: 10 }}>
                  <span className="ui-eb">{cur ? `Current step · ${cur.n} of ${steps.length}` : "Current step"}</span>
                  {cur?.is_judgment_call && <Badge kind="judgment" />}
                </div>
                <h2 className="ui-t2">{cur ? cur.title : `Waiting for the first step of ${p.workmap?.task ?? "the Work Map"}.`}</h2>
                {steps.length > 0 && (
                  <div className="flex" style={{ gap: 4 }} aria-label={cur ? `Progress: step ${cur.n} of ${steps.length}` : "Progress"}>
                    {steps.map((s) => (
                      <span key={s.n} style={{ height: 6, borderRadius: 3, flex: 1, background: segColor(s, cur?.n ?? null) }} />
                    ))}
                  </div>
                )}
                <span className="text-xs" style={{ color: "var(--fa)" }}>
                  {decideStatus(p.stats)}
                </span>
              </div>
            </Card>

            <Card className="relative flex flex-col" style={{ padding: 0 }}>
              <div className="flex flex-wrap items-center justify-between" style={{ padding: "16px 22px", borderBottom: "1px solid var(--ln)", gap: 10 }}>
                <h2 className="ui-t3">Tutor transcript</h2>
                <span className="text-xs" style={{ color: "var(--fa)" }}>
                  {p.textMode ? "Typed, no voice" : "Spoken by the tutor, captions here"}
                </span>
              </div>
              <ChatThread lines={p.transcript} intervention={iv} />
              {p.running && <Composer enabled={!sendError} error={sendError} onSend={p.onAnswer} />}
            </Card>
          </div>

          <div className="flex min-w-0 flex-col" style={{ flex: "2 1 360px", gap: 20 }}>
            {iv && (
              <Card className="flex flex-col" style={{ padding: 22, gap: 14, background: "var(--stage)" }}>
                <section data-testid="intervention" className="flex flex-col" style={{ gap: 14 }}>
                  <div className="flex items-center justify-between" style={{ gap: 10 }}>
                    <h2 className="ui-t3">Replay {iv.expert}&apos;s moment</h2>
                    <Button variant="secondary" size="sm" onClick={p.onReplay}>
                      {p.replayOpen ? "Hide" : "Play"}
                    </Button>
                  </div>
                  {p.replayOpen && (
                    <figure data-testid="replay" className="m-0">
                      {img ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={img} alt={`${iv.expert}'s screen at step ${iv.step.n}`} style={{ maxWidth: "100%", borderRadius: 12, border: "1px solid var(--ln2)" }} />
                      ) : (
                        <p className="text-xs" style={{ color: "var(--mu)" }}>No frame stored for this moment.</p>
                      )}
                    </figure>
                  )}
                  <p data-testid="expert-quote" style={{ ...serifQuote, fontSize: 28, lineHeight: 1.15 }}>
                    &ldquo;{iv.replay.quote || iv.quote}&rdquo;
                  </p>
                  <span className="text-[13px]" style={{ color: "var(--mu)" }}>
                    {iv.expert} · step {iv.step.n}
                  </span>
                  {iv.notice && <p className="text-xs" style={{ color: "var(--am)" }}>{iv.notice}</p>}
                </section>
              </Card>
            )}
            <Card className="flex flex-col" style={{ padding: "20px 22px", gap: 10 }}>
              <h2 className="ui-t3">On your screen now</h2>
              {host === "websocket" ? <AppStatus companion={p.companion} /> : <CompanionSlot host={host} companion={p.companion} />}
              {host === "websocket" && p.companion.status !== "paired" && (
                <p className="text-xs" style={{ color: "var(--mu)" }}>Companion not paired: the tutor stops by voice only, no halo over the app.</p>
              )}
            </Card>
          </div>
        </div>
      )}
    </main>
  );
}
