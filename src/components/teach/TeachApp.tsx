"use client";

// Teach (docs/BUILD_SPEC.md Module 3): the learner works in the teach-mode ERP while the tutor
// predicts, intercepts guardrail breaks in the save hook, replays the expert's moment and sums up mastery.
// Voice is optional: if the tutor cannot start, everything runs in text mode in the side panel.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ErpSandbox from "@/components/erp/ErpSandbox";
import StepMoment from "@/components/workmap/StepMoment";
import { SEED_INVOICES } from "@/lib/erp/seed";
import type { BeforeSaveHook, ErpEvent } from "@/lib/erp/store";
import { checkPendingAction, decideViaApi, predictionStepFor, type CheckResult } from "@/lib/teach/guardrailCheck";
import { recordFixed, recordPrediction, recordStop, scorePrediction, summary, type MasteryState, type MasterySummary } from "@/lib/teach/mastery";
import type { WorkMapStep } from "@/lib/types";
import { buildGuardrailStopTurn, buildMasteryTurn, buildPredictTurn } from "@/lib/voice/prompts";
import { useVoiceAgent, VoiceProvider, type UseVoiceAgentOptions } from "@/lib/voice/useVoiceAgent";
import { exportGuardrailsMarkdown } from "@/lib/workmap/export";
import { voiceStartNotice } from "@/components/capture/dailyLimit";
import Halo from "./Halo";
import { loadWorkMap, type LoadedMap } from "./loadWorkMap";

type Stop = Required<Pick<CheckResult, "step" | "explanation">> & Pick<CheckResult, "field" | "guardrail">;
type Prediction = { invoiceId: string; step: WorkMapStep; answer?: string; correct?: boolean };

export default function TeachApp({ sessionId }: { sessionId: string | null }) {
  const [loaded, setLoaded] = useState<LoadedMap | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadWorkMap(sessionId).then((l) => {
      if (!cancelled) setLoaded(l);
    });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  if (!loaded) return <main className="p-8 text-sm text-slate-400">Loading Work Map…</main>;
  return (
    <VoiceProvider>
      <TeachSession loaded={loaded} />
    </VoiceProvider>
  );
}

function TeachSession({ loaded }: { loaded: LoadedMap }) {
  const { workmap } = loaded;
  const expert = workmap.expert;
  const markdown = useMemo(() => exportGuardrailsMarkdown(workmap), [workmap]);

  const [voiceMode, setVoiceMode] = useState(false);
  const [voiceNote, setVoiceNote] = useState<string | null>("Text mode. Start the tutor voice to talk instead of type.");
  const [stop, setStop] = useState<Stop | null>(null);
  const [fixedNote, setFixedNote] = useState<string | null>(null);
  const [replayN, setReplayN] = useState<number | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [current, setCurrent] = useState<WorkMapStep | null>(null);
  const [mastery, setMastery] = useState<MasteryState>({});
  const [finished, setFinished] = useState<MasterySummary | null>(null);
  const [tutorLines, setTutorLines] = useState<string[]>([]);
  const [typed, setTyped] = useState("");
  const [why, setWhy] = useState("");

  const stopRef = useRef<Stop | null>(null);
  const predictionRef = useRef<Prediction | null>(null);
  const voiceModeRef = useRef(false);
  const injectedRef = useRef(false);

  const clientTools = useMemo<NonNullable<UseVoiceAgentOptions["clientTools"]>>(
    () => ({
      replay_moment: (p) => {
        const n = Number(p?.step_n);
        setReplayN(Number.isFinite(n) ? n : (stopRef.current?.step.n ?? null));
        return "ok";
      },
    }),
    [],
  );

  const answerPrediction = useCallback((text: string) => {
    const p = predictionRef.current;
    if (!p || p.answer !== undefined || !text.trim()) return;
    const correct = scorePrediction(text, p.step);
    const next = { ...p, answer: text.trim(), correct };
    predictionRef.current = next;
    setPrediction(next);
    setMastery((m) => recordPrediction(m, p.step.n, correct));
  }, []);

  const onTranscript = useCallback<UseVoiceAgentOptions["onTranscript"]>(
    (e) => {
      if (e.speaker === "agent") setTutorLines((l) => [...l.slice(-3), e.text]);
      else answerPrediction(e.text);
    },
    [answerPrediction],
  );

  const agent = useVoiceAgent({ role: "tutor", clientTools, onTranscript });
  const agentRef = useRef(agent);
  useEffect(() => {
    agentRef.current = agent;
  }, [agent]);

  // Inject the Work Map once the tutor is connected.
  useEffect(() => {
    if (agent.status !== "connected" || injectedRef.current) return;
    injectedRef.current = true;
    agent.injectContext(`Work Map of ${expert} (guardrails export):\n${markdown}\n\nWork Map JSON:\n${JSON.stringify(workmap)}`);
  }, [agent, agent.status, expert, markdown, workmap]);

  const say = useCallback((turn: string) => {
    if (voiceModeRef.current) agentRef.current.promptTurn(turn);
  }, []);

  async function startVoice() {
    setVoiceNote("Starting tutor voice…");
    try {
      await agent.start({ dynamicVariables: { expert, work_map: markdown } });
      voiceModeRef.current = true;
      setVoiceMode(true);
      setVoiceNote(null);
    } catch (err) {
      voiceModeRef.current = false;
      setVoiceMode(false);
      setVoiceNote(voiceStartNotice(err instanceof Error ? err.message : String(err), "Text mode: type your answers here."));
    }
  }

  const onEvent = useCallback(
    (e: ErpEvent) => {
      if (e.type !== "record_opened") return;
      const inv = SEED_INVOICES.find((i) => i.id === e.entity.id);
      if (!inv) return;
      const step = predictionStepFor(workmap, inv);
      if (!step) return;
      const p: Prediction = { invoiceId: inv.id, step };
      predictionRef.current = p;
      setPrediction(p);
      setCurrent(step);
      stopRef.current = null;
      setStop(null);
      setReplayN(null);
      setFixedNote(null);
      setTyped("");
      say(buildPredictTurn(step));
    },
    [workmap, say],
  );

  const onBeforeSave = useCallback<BeforeSaveHook>(
    async ({ action, draft }) => {
      const r = await checkPendingAction({ action, draft, workmap, decide: decideViaApi });
      if (!r.allow && r.step) {
        const s: Stop = { step: r.step, explanation: r.explanation ?? "", field: r.field, guardrail: r.guardrail };
        stopRef.current = s;
        setStop(s);
        setCurrent(r.step);
        setReplayN(null);
        setWhy("");
        setFixedNote(null);
        setMastery((m) => recordStop(m, r.step!.n));
        const pending = `${action.replace("_", " ")} invoice ${draft.id} (cost center ${draft.cost_center}, asset number ${draft.asset_number || "empty"}, ${draft.supplier_country}/${draft.supplier_entity})`;
        say(buildGuardrailStopTurn({ expert, step: r.step, pending }));
        return { allow: false, message: r.explanation };
      }
      if (stopRef.current) {
        setFixedNote(`Done: ${action.replace("_", " ")} went through after the stop on "${stopRef.current.step.title}".`);
        stopRef.current = null;
        setStop(null);
        setMastery((m) => recordFixed(m));
      }
      return { allow: true };
    },
    [workmap, expert, say],
  );

  function finish() {
    const s = summary(mastery, workmap.steps);
    setFinished(s);
    if (voiceModeRef.current) say(buildMasteryTurn(s.text));
    else if (typeof window !== "undefined" && "speechSynthesis" in window) {
      window.speechSynthesis.speak(new SpeechSynthesisUtterance(s.text));
    }
  }

  const replayStep = replayN !== null ? workmap.steps.find((s) => s.n === replayN) : undefined;
  const frameSession = loaded.sessionId ?? "sample";
  const status = voiceMode ? `Voice: ${agent.status}${agent.isSpeaking ? ", speaking" : ""}` : "Text mode";

  return (
    <main className="flex flex-col gap-3 p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-semibold">Teach: {workmap.task}</h1>
          <p className="text-xs text-slate-500">Learning from {expert}</p>
        </div>
        <p className="rounded border border-slate-200 bg-slate-50 px-2 py-1 text-xs text-slate-600">{loaded.banner}</p>
      </header>

      <div className="flex flex-col gap-4 lg:flex-row">
        <section className="lg:w-2/3">
          <ErpSandbox mode="teach" onEvent={onEvent} onBeforeSave={onBeforeSave} highlightField={stop?.field ?? null} />
        </section>

        <aside className="flex flex-col gap-3 lg:w-1/3">
          <div className="flex items-center justify-between rounded border border-slate-200 p-2 text-sm">
            <span>
              Tutor: <span className="font-medium">{status}</span>
            </span>
            {!voiceMode && (
              <button type="button" onClick={() => void startVoice()} className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50">
                Start tutor voice
              </button>
            )}
          </div>
          {voiceNote && <p className="text-xs text-slate-500">{voiceNote}</p>}
          {tutorLines.length > 0 && (
            <div className="rounded bg-slate-50 p-2 text-xs text-slate-600">
              {tutorLines.map((l, i) => (
                <p key={i}>Tutor: {l}</p>
              ))}
            </div>
          )}

          {!prediction && !stop && <p className="text-sm text-slate-500">Open invoice 4630 to start.</p>}

          {stop && (
            <div role="alert" className="flex flex-col gap-2 rounded border-2 border-rose-400 bg-rose-50 p-3">
              <p className="font-semibold text-rose-900">{expert} would stop here. Why do you think?</p>
              <p className="text-sm text-rose-900">{stop.explanation}</p>
              <p className="text-xs text-rose-800">
                Step {stop.step.n}: {stop.step.title}. Nothing was saved.
              </p>
              <textarea
                value={why}
                onChange={(e) => setWhy(e.target.value)}
                placeholder="Your answer (optional)"
                rows={2}
                className="border border-rose-200 bg-white px-2 py-1 text-sm"
              />
              <button
                type="button"
                onClick={() => setReplayN(stop.step.n)}
                className="self-start rounded bg-rose-600 px-3 py-1 text-sm text-white hover:bg-rose-700"
              >
                Replay {expert}&apos;s moment
              </button>
            </div>
          )}
          {fixedNote && <p className="rounded border border-green-300 bg-green-50 px-2 py-1 text-sm text-green-800">{fixedNote}</p>}

          {replayStep && (
            <div className="rounded border border-slate-200 p-2">
              <div className="mb-1 flex items-center justify-between">
                <p className="text-sm font-medium">
                  {expert}&apos;s moment: step {replayStep.n}, {replayStep.title}
                </p>
                <button type="button" onClick={() => setReplayN(null)} className="text-xs underline">
                  close
                </button>
              </div>
              <StepMoment sessionId={frameSession} expert={expert} moment={replayStep.screen_moment} reason={replayStep.reason} compact />
            </div>
          )}

          {prediction && (
            <div className="flex flex-col gap-2 rounded border border-slate-200 p-3">
              <p className="text-sm font-semibold">Invoice {prediction.invoiceId}: What would you do next?</p>
              {prediction.answer === undefined ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    answerPrediction(typed);
                  }}
                  className="flex gap-2"
                >
                  <input
                    value={typed}
                    onChange={(e) => setTyped(e.target.value)}
                    placeholder={voiceMode ? "Say it, or type it" : "Type your answer"}
                    className="flex-1 border border-slate-300 px-2 py-1 text-sm"
                  />
                  <button type="submit" className="rounded bg-slate-800 px-3 py-1 text-sm text-white">
                    Answer
                  </button>
                </form>
              ) : (
                <div className="text-sm">
                  <p className="text-slate-600">You: {prediction.answer}</p>
                  <p className={prediction.correct ? "text-green-700" : "text-amber-700"}>
                    {prediction.correct ? `That matches what ${expert} does.` : `Not quite what ${expert} does.`}
                  </p>
                </div>
              )}
            </div>
          )}

          {current && (prediction?.answer !== undefined || stop) && (
            <div className="rounded border border-slate-200 p-3 text-sm">
              <p className="text-xs uppercase tracking-wide text-slate-500">
                Step {current.n}: {current.title}
              </p>
              <p className="mt-1">{current.decision}</p>
              {current.reason && (
                <p className="mt-1 italic text-slate-700">
                  {expert}: &ldquo;{current.reason.quote}&rdquo;
                </p>
              )}
            </div>
          )}

          <button type="button" onClick={finish} className="self-start rounded border border-slate-400 px-3 py-1 text-sm hover:bg-slate-50">
            Finish
          </button>
          {finished && (
            <div className="rounded border border-slate-300 bg-slate-50 p-3 text-sm">
              <p className="font-semibold">Mastery summary</p>
              <p className="mt-1">{finished.text}</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                <div>
                  <p className="font-medium text-green-700">Mastered</p>
                  <ul className="list-disc pl-4">{finished.mastered.length ? finished.mastered.map((m) => <li key={m}>{m}</li>) : <li>none yet</li>}</ul>
                </div>
                <div>
                  <p className="font-medium text-amber-700">Practice next</p>
                  <ul className="list-disc pl-4">
                    {finished.practice_next.length ? finished.practice_next.map((m) => <li key={m}>{m}</li>) : <li>nothing</li>}
                  </ul>
                </div>
              </div>
            </div>
          )}
        </aside>
      </div>

      <Halo field={stop?.field ?? null} label={stop ? `${expert} would stop here` : undefined} />
    </main>
  );
}
