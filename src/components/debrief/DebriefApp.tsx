"use client";

// Module 2 debrief: gap-driven follow-ups, rising scores, spoken teach-back with expert confirm.
// Voice is optional: when it cannot start, the question shows on screen and the expert types the answer.
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { voiceStartNotice } from "@/components/capture/dailyLimit";
import WorkMapView from "@/components/workmap/WorkMapView";
import { createDebriefController, type DebriefController, type DebriefState } from "@/lib/debrief/controller";
import { createHttpDebriefApi } from "@/lib/debrief/httpApi";
import type { Session } from "@/lib/types";
import { useVoiceAgent, VoiceProvider, type UseVoiceAgentOptions } from "@/lib/voice/useVoiceAgent";
import ScoreBars from "./ScoreBars";
import TeachBackPanel from "./TeachBackPanel";

const END_LABEL: Record<NonNullable<DebriefState["endReason"]>, string> = {
  "all steps above threshold": "All steps are above the threshold.",
  "question budget reached": "Question budget reached.",
};

const snapshot = (s: Readonly<DebriefState>): DebriefState => ({ ...s, history: [...s.history], asked: [...s.asked] });

export default function DebriefApp({ sessionId }: { sessionId: string }) {
  return (
    <VoiceProvider>
      <DebriefInner sessionId={sessionId} />
    </VoiceProvider>
  );
}

function DebriefInner({ sessionId }: { sessionId: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [view, setView] = useState<DebriefState | null>(null);
  const [answer, setAnswer] = useState("");
  const ctrlRef = useRef<DebriefController | null>(null);
  const voiceModeRef = useRef(false);

  useEffect(() => {
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
  }, [sessionId]);

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

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 p-8">
      <header className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Debrief</h1>
        {view && (
          <span className="text-sm text-slate-600">
            Follow-up {view.followUpsAsked + (view.question ? 1 : 0)} of at least {view.minFollowUps}
            <span className="text-slate-400"> (max {view.maxFollowUps})</span>
          </span>
        )}
      </header>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-amber-700">{notice}</p>}
      {view?.error &&
        (view.error.includes("/api/workmap 429") ? (
          <p role="alert" className="rounded border border-red-300 bg-red-50 p-2 text-sm text-red-900">
            Daily limit for Work Map building reached in this workspace (resets at midnight). Your answers are saved; build
            the Work Map again tomorrow.
          </p>
        ) : (
          <p className="text-sm text-red-600">{view.error}</p>
        ))}
      {!session && !error && <p className="text-sm text-slate-400">Loading…</p>}

      {session && !view && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-slate-600">
            A few follow-up questions about what is still unclear, then I explain the whole process back so you can confirm
            or correct it.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={starting}
              onClick={() => start(true)}
              className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
            >
              {starting ? "Starting…" : "Start debrief"}
            </button>
            <button
              type="button"
              disabled={starting}
              onClick={() => start(false)}
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50 disabled:opacity-50"
            >
              Text mode
            </button>
          </div>
        </div>
      )}

      {phase === "building" && <p className="text-sm text-slate-500">Building the Work Map…</p>}

      {view && !inTeachBack && phase !== "building" && view.question && (
        <section className="flex flex-col gap-2 rounded border border-slate-200 p-4">
          <span className="text-xs uppercase tracking-wide text-slate-500">
            Question {view.followUpsAsked + 1}
            {view.question.step_n ? ` · step ${view.question.step_n}` : ""} · about the {view.question.about}
          </span>
          <p className="text-base">{view.question.text}</p>
          {textMode && (
            <form
              className="flex gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                if (!answer.trim()) return;
                void ctrlRef.current?.onExpertUtterance(answer);
                setAnswer("");
              }}
            >
              <input
                autoFocus
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                placeholder="Type your answer"
                className="flex-1 rounded border border-slate-300 px-2 py-1 text-sm"
              />
              <button
                type="submit"
                disabled={view.busy || !answer.trim()}
                className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
              >
                Answer
              </button>
            </form>
          )}
        </section>
      )}
      {view?.busy && phase === "asking" && !view.question && (
        <p className="text-sm text-slate-500">Updating the Work Map with your answer…</p>
      )}

      {view?.endReason && (
        <p className="text-sm text-slate-700">
          Debrief questions done after {view.followUpsAsked}: {END_LABEL[view.endReason]}
        </p>
      )}

      {view && view.history.length > 0 && <ScoreBars history={view.history} titles={titles} />}

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

      {phase === "confirmed" && view?.workmap && (
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <span className="rounded bg-green-100 px-2 py-0.5 text-sm text-green-800">Confirmed by the expert</span>
            <Link className="text-sm underline" href={`/map/${encodeURIComponent(sessionId)}`}>
              Open the Work Map
            </Link>
          </div>
          <WorkMapView sessionId={sessionId} workmap={view.workmap} />
        </section>
      )}
    </main>
  );
}
