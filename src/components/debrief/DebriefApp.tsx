"use client";

// Module 2 debrief: gap-driven follow-ups, rising scores, spoken teach-back with expert confirm.
// Voice is optional: when it cannot start, the question shows on screen and the expert types the answer.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { voiceStartNotice } from "@/components/capture/dailyLimit";
import WorkMapViewer from "@/components/map/WorkMapViewer";
import { buttonClass } from "@/components/ui";
import { createDebriefController, type DebriefController, type DebriefState } from "@/lib/debrief/controller";
import { createHttpDebriefApi } from "@/lib/debrief/httpApi";
import { SCORE_THRESHOLD, type Session } from "@/lib/types";
import { useVoiceAgent, VoiceProvider, type UseVoiceAgentOptions } from "@/lib/voice/useVoiceAgent";
import AgentAvatar from "@/components/agents/AgentAvatar";
import ScoreBars from "./ScoreBars";
import TeachBackPanel from "./TeachBackPanel";

const END_LABEL: Record<NonNullable<DebriefState["endReason"]>, string> = {
  "all steps above threshold": "All steps are above the threshold.",
  "question budget reached": "Question budget reached.",
};

const snapshot = (s: Readonly<DebriefState>): DebriefState => ({ ...s, history: [...s.history], asked: [...s.asked] });

/** Local preview routes only (design compare): a fixed session and debrief state, nothing is fetched. */
export type DebriefPreview = { session: Session; view: DebriefState; liveAnswer?: { speaker: string; text: string } | null; avatar?: unknown };

export default function DebriefApp({ sessionId, preview }: { sessionId: string; preview?: DebriefPreview }) {
  return (
    <VoiceProvider>
      <DebriefInner sessionId={sessionId} preview={preview} />
    </VoiceProvider>
  );
}

function DebriefInner({ sessionId, preview }: { sessionId: string; preview?: DebriefPreview }) {
  const [session, setSession] = useState<Session | null>(preview?.session ?? null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [view, setView] = useState<DebriefState | null>(preview?.view ?? null);
  const liveAnswer = preview?.liveAnswer ?? null;
  const [answer, setAnswer] = useState("");
  const ctrlRef = useRef<DebriefController | null>(null);
  const voiceModeRef = useRef(false);

  useEffect(() => {
    if (preview) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/session/${encodeURIComponent(sessionId)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(res.status === 404 ? "Session not found." : `GET session ${res.status}`);
        const s = (await res.json()) as Session;
        if (!cancelled) setSession(s);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, preview]);

  const clientTools = useMemo<NonNullable<UseVoiceAgentOptions["clientTools"]>>(
    () => ({
      confirm_teach_back: (p) => {
        const correction = typeof p.correction === "string" ? p.correction : undefined;
        void ctrlRef.current?.onTeachBackResult({ confirmed: Boolean(p.confirmed), correction });
        return "ok";
      },
    }),
    [],
  );
  const onTranscript = useCallback<UseVoiceAgentOptions["onTranscript"]>((e) => {
    const ctrl = ctrlRef.current;
    if (!ctrl) return;
    if (e.speaker === "agent") ctrl.onAgentUtterance(e.text);
    else void ctrl.onExpertUtterance(e.text);
  }, []);
  const agent = useVoiceAgent({ role: "interviewer", clientTools, onTranscript });
  const agentRef = useRef(agent);
  useEffect(() => {
    agentRef.current = agent;
  });

  useEffect(
    () => () => {
      ctrlRef.current?.stop();
      if (voiceModeRef.current) void agentRef.current.stop();
    },
    [],
  );

  async function start(withVoice: boolean) {
    if (!session || starting || ctrlRef.current) return;
    setStarting(true);
    setNotice(null);
    if (withVoice) {
      try {
        await agentRef.current.start({ dynamicVariables: { expert: session.expert ?? "the expert" } });
        voiceModeRef.current = true;
      } catch (err) {
        setNotice(voiceStartNotice(err instanceof Error ? err.message : String(err), "Running in text mode."));
      }
    }
    setTextMode(!voiceModeRef.current);
    const capturedIds = new Set(session.qa.filter((q) => q.phase === "capture").map((q) => q.event_id));
    const ctrl = createDebriefController({
      api: createHttpDebriefApi(sessionId),
      voice: {
        promptTurn: (t) => {
          if (voiceModeRef.current) agentRef.current.promptTurn(t);
        },
        injectContext: (t) => {
          if (voiceModeRef.current) agentRef.current.injectContext(t);
        },
      },
      sessionId,
      session,
      savedForDebrief: session.events.filter((e) => e.type !== "record_opened" && !capturedIds.has(e.id)),
      now: () => Date.now(),
      onChange: () => setView(snapshot(ctrl.getState())),
    });
    ctrlRef.current = ctrl;
    setStarting(false);
    await ctrl.start();
  }

  const titles = useMemo(
    () => Object.fromEntries((view?.workmap?.steps ?? []).map((s) => [s.n, s.title])) as Record<number, string>,
    [view?.workmap],
  );

  const phase = view?.phase ?? "idle";
  const inTeachBack = phase === "teach_back" || phase === "corrected" || phase === "confirmed";

  const followUp = view ? `Follow-up ${view.followUpsAsked + (view.question ? 1 : 0)} of at least ${view.minFollowUps}` : null;
  const threshold = Math.round(SCORE_THRESHOLD * 100);

  return (
    <main className="flex min-w-0 flex-col" style={{ padding: "28px 40px 56px", gap: 22 }}>
      <header className="flex flex-wrap items-end justify-between" style={{ gap: 16 }}>
        <div className="flex flex-col" style={{ gap: 6 }}>
          <Link className="text-[13px] no-underline" style={{ color: "var(--mu)" }} href={`/map/${encodeURIComponent(sessionId)}`}>
            Work Map / Debrief
          </Link>
          <h1 className="ui-t1">Debrief</h1>
          {view?.workmap && <span style={{ color: "var(--mu)" }}>{view.workmap.task}</span>}
        </div>
        {view && phase !== "confirmed" && (
          <Link className={buttonClass("ghost")} href={`/map/${encodeURIComponent(sessionId)}`}>
            Finish later
          </Link>
        )}
      </header>

      {error && <p role="alert" className="text-[13px]" style={{ color: "var(--rd)" }}>{error}</p>}
      {notice && <p className="text-[13px]" style={{ color: "var(--am)" }}>{notice}</p>}
      {view?.error &&
        (view.error.includes("/api/workmap 429") ? (
          <p role="alert" className="text-[13px]" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--rds)", color: "var(--rd)" }}>
            Daily limit for Work Map building reached in this workspace (resets at midnight). Your answers are saved; build
            the Work Map again tomorrow.
          </p>
        ) : (
          <p className="text-[13px]" style={{ color: "var(--rd)" }}>{view.error}</p>
        ))}
      {!session && !error && <p className="text-[13px]" style={{ color: "var(--fa)" }}>Loading…</p>}

      <div className="flex flex-wrap items-start" style={{ gap: 20 }}>
        <div className="flex min-w-0 flex-col" style={{ flex: "3 1 560px", gap: 20 }}>
          {session && !view && (
            <div className="ui-card flex flex-col items-start" style={{ padding: 28, gap: 18, background: "var(--stage)" }}>
              <p style={{ fontSize: 15 }}>
                A few follow-up questions about what is still unclear, then I explain the whole process back so you can confirm
                or correct it.
              </p>
              <div className="flex flex-wrap" style={{ gap: 10 }}>
                <button type="button" disabled={starting} onClick={() => start(true)} className={buttonClass("primary", "lg")}>
                  {starting ? "Starting…" : "Start debrief"}
                </button>
                <button type="button" disabled={starting} onClick={() => start(false)} className={buttonClass("secondary", "lg")}>
                  Text mode
                </button>
              </div>
            </div>
          )}

          {phase === "building" && <p className="text-[13px]" style={{ color: "var(--mu)" }}>Building the Work Map…</p>}

          {view && !inTeachBack && phase !== "building" && view.question && (
            <section className="ui-card flex flex-col" style={{ padding: 28, gap: 22, background: "var(--stage)" }} data-testid="debrief-question">
              <div className="flex flex-wrap items-center justify-between" style={{ gap: 12 }}>
                <span className="ui-bdg ui-bdg-nd ui-k-ac">
                  {followUp}
                  <span style={{ opacity: 0.7 }}> (max {view.maxFollowUps})</span>
                </span>
                <span className="text-xs" style={{ color: "var(--fa)" }}>
                  Asks until every step is above {threshold}%
                </span>
              </div>
              <div className="flex flex-wrap items-start" style={{ gap: 22 }}>
              {preview?.avatar !== undefined && <AgentAvatar avatar={preview.avatar} state="talking" size={112} />}
              <div className="flex flex-col" style={{ flex: 1, minWidth: 280, gap: 10 }}>
                <p className="ui-t2">&ldquo;{view.question.text}&rdquo;</p>
                <span className="text-[13px]" style={{ color: "var(--mu)" }}>
                  Question {view.followUpsAsked + 1}
                  {view.question.step_n ? ` · About step ${view.question.step_n}` : ""}
                  {view.question.step_n && titles[view.question.step_n] ? ` · ${titles[view.question.step_n]}` : ""} · about the {view.question.about}
                </span>
              </div>
              </div>
              {liveAnswer && (
                <div
                  data-testid="live-answer"
                  className="self-end"
                  style={{ maxWidth: 560, background: "var(--s2)", border: "1px solid var(--ln2)", borderRadius: "18px 18px 6px 18px", padding: "12px 16px" }}
                >
                  <span className="block text-xs" style={{ color: "var(--mu)", marginBottom: 4 }}>
                    {liveAnswer.speaker} · answering
                  </span>
                  {liveAnswer.text}
                  <span style={{ color: "var(--mu)" }}>…</span>
                </div>
              )}
              {!textMode && (
                // Voice mode: the expert answers out loud; the session listens until a 2 s pause.
                <div className="flex flex-wrap items-center" style={{ gap: 14 }} data-testid="listening" role="status">
                  <span className={buttonClass("primary", "lg")} style={{ cursor: "default" }}>
                    <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true">
                      <rect x="9" y="3" width="6" height="11" rx="3" />
                      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
                    </svg>
                    Listening
                  </span>
                  <span className="inline-flex items-center" style={{ gap: 3, height: 28 }} aria-hidden="true">
                    {[10, 22, 16, 26, 12, 20, 8].map((h, i) => (
                      <span key={i} className="ui-wv" style={{ height: h, animationDelay: `${i / 10}s` }} />
                    ))}
                  </span>
                  <span className="text-[13px]" style={{ color: "var(--mu)" }}>
                    Pause for 2 s to finish
                  </span>
                </div>
              )}
              {textMode && (
                <form
                  className="flex flex-wrap"
                  style={{ gap: 10 }}
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!answer.trim()) return;
                    void ctrlRef.current?.onExpertUtterance(answer);
                    setAnswer("");
                  }}
                >
                  <input autoFocus value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="Type your answer" className="ui-inp flex-1" />
                  <button type="submit" disabled={view.busy || !answer.trim()} className={buttonClass("primary")}>
                    Answer
                  </button>
                </form>
              )}
            </section>
          )}
          {view?.busy && phase === "asking" && !view.question && (
            <p className="text-[13px]" style={{ color: "var(--mu)" }}>Updating the Work Map with your answer…</p>
          )}

          {view?.endReason && (
            <p className="text-[13px]" style={{ color: "var(--mu)" }}>
              Debrief questions done after {view.followUpsAsked}: {END_LABEL[view.endReason]}
            </p>
          )}

          {view?.teachBack && inTeachBack && (
            <TeachBackPanel
              text={view.teachBack}
              corrected={phase === "corrected"}
              confirmed={phase === "confirmed"}
              busy={view.busy}
              awaitingCorrection={view.awaitingCorrection}
              onResult={(r) => void ctrlRef.current?.onTeachBackResult(r)}
            />
          )}
        </div>

        {view && view.history.length > 0 && (
          <div className="flex min-w-0 flex-col" style={{ flex: "2 1 340px" }}>
            <ScoreBars history={view.history} titles={titles} />
          </div>
        )}
      </div>

      {phase === "confirmed" && view?.workmap && (
        <section className="flex flex-col" style={{ gap: 14 }}>
          <div className="flex items-center" style={{ gap: 12 }}>
            <span className="ui-bdg ui-k-ok">Confirmed by the expert</span>
            <Link className={buttonClass("secondary", "sm")} href={`/map/${encodeURIComponent(sessionId)}`}>
              Open the Work Map
            </Link>
          </div>
          <WorkMapViewer sessionId={sessionId} workmap={view.workmap} />
        </section>
      )}
    </main>
  );
}
