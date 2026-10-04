"use client";

// Teach on real apps (pivot). The learner picks a confirmed Work Map, starts the tutor voice, shares the whole
// screen and pairs the desktop companion. Frames -> /api/vision events -> step match -> prediction prompts at
// natural pauses and guardrail stops by voice and the companion buddy ('stop' point) before the save.
// The buddy also mirrors the tutor (state, captions, glances) and the companion shortcuts drive the controls. Finish stores Session.teach.
// One-app D2: the companion is a transport (desktop app bridge, opt-in WebSocket or none); in the app Start
// also shares the screen without a picker and the window steps aside until Finish. Start order: the voice agent
// first (mic prompt, start error visible), then the share, then the step-aside only when voice runs.
// Rollback: revert this task's commit; the page then shows the previous placeholder.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startScreenCapture, type CaptureHandle, type CapturedFrame } from "@/lib/perception/capture";
import type { CompanionPermissions, CompanionStatus, ShortcutAction } from "@/lib/companion/client";
import { selectTransport, type CompanionTransport, type TransportHost } from "@/lib/companion/transport";
import { createShareFlow, startVoiceThenShare } from "@/lib/companion/stepAside";
import { buddyStateFor } from "@/lib/companion/buddyState";
import { routeShortcut } from "@/lib/companion/shortcuts";
import { bindTeachTransport, stopPointSink, teachShortcutControls } from "@/lib/teach/companionBridge";
import { COMPANION_STALE_MS, MIN_SILENCE_MS, effectiveActivity } from "@/lib/voice/askGate";
import { buildGuardrailStopTurn, buildMasteryTurn, buildPredictTurn } from "@/lib/voice/prompts";
import { useVoiceAgent, VoiceProvider, type UseVoiceAgentOptions } from "@/lib/voice/useVoiceAgent";
import { COOLDOWN_MS, createInterventionEngine, decideViaApi, type Intervention, type InterventionEngine, type InterventionStats } from "@/lib/teach/intervention";
import { buildTeachProgress, recordPrediction, recordStop, scorePrediction, summary, type MasteryState } from "@/lib/teach/mastery";
import { matchStep } from "@/lib/teach/stepMatch";
import { createShortcutCoach, type ShortcutCoach } from "@/lib/teach/shortcutHint";
import { SHORTCUT_LEARNING } from "@/lib/companion/chord";
import { newId, type Rect, type ScreenEvent, type VisionEvent, type WorkMap, type WorkMapStep } from "@/lib/types";
import { loadPickerOptions, loadWorkMap, preselect, type PickerOption } from "./loadWorkMap";
import AgentHeader from "@/components/agents/AgentHeader";
import { agentBlocker, useAgent } from "@/components/agents/useAgent";
import { checkTeachSource, teachSessionBody } from "./agentSource";
import { sendTextTurn, textTurnError } from "./textTurn";
import TeachConsole, { type TeachConsoleProps, type TeachLine } from "./TeachConsole";

/** agentParam: ?agent, the agent of the new teach session. sessionId: ?session, the source Work Map capture session. */
/** transport: injected for tests; otherwise selected on mount (bridge, opt-in WebSocket or none). */
export type TeachAppProps = { sessionId: string | null; localMode: boolean; agentParam?: string | null; transport?: CompanionTransport };

const NO_STATS: InterventionStats = { interventions: 0, active: 0, decideCalls: 0, decideFailures: 0, lastDecideError: null, capped: false };
const PREDICT_QUESTION = "What would you do next?";
const MONITOR_WARNING =
  "You shared a window or tab, not the whole screen. Halos are off because their position would be wrong. Stop sharing and pick the entire screen.";

type Loop = {
  sessionId: string;
  workmap: WorkMap;
  engine: InterventionEngine;
  t0: number;
  events: ScreenEvent[];
  visionBusy: boolean;
  lastFrameChange: number;
  step: WorkMapStep | null;
  predicted: Set<number>;
  awaiting: WorkMapStep | null;
  nextToAsk: WorkMapStep | null;
  paused: boolean;
  /** Last screen position seen per step, for the buddy's glance at prediction prompts. */
  lastRect: Map<number, Rect>;
  /** Shortcut hints on the slow path (agents wave A5). */
  coach: ShortcutCoach;
  /** When the last guardrail stop fired; a shortcut hint waits out COOLDOWN_MS after it. */
  lastStopAt: number;
};

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} ${res.status}`);
  return (await res.json()) as T;
}

export default function TeachApp(props: TeachAppProps) {
  return (
    <VoiceProvider>
      <TeachInner {...props} />
    </VoiceProvider>
  );
}

function TeachInner({ sessionId, localMode, agentParam = null, transport }: TeachAppProps) {
  const agentLoad = useAgent(agentParam);
  const agentId = agentLoad.status === "ok" ? agentLoad.agent.id : null;
  const [sourceCheck, setSourceCheck] = useState<{ key: string; error: string | null } | null>(null);
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  // The source error belongs to one agent + Work Map pair; it reads as null as soon as either changes.
  const sourceError =
    agentId && selected && sourceCheck?.key === `${agentId}:${selected}` ? sourceCheck.error : null;
  const [workmap, setWorkmap] = useState<WorkMap | null>(null);
  const [workmapSessionId, setWorkmapSessionId] = useState<string | null>(null);
  const [banner, setBanner] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [paused, setPaused] = useState(false);
  const [sharing, setSharing] = useState(false);
  const [shareWarning, setShareWarning] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [textMode, setTextMode] = useState(false);
  const [currentStep, setCurrentStep] = useState<WorkMapStep | null>(null);
  const [transcript, setTranscript] = useState<TeachLine[]>([]);
  const [intervention, setIntervention] = useState<Intervention | null>(null);
  const [replayOpen, setReplayOpen] = useState(false);
  const [stats, setStats] = useState<InterventionStats>(NO_STATS);
  const [result, setResult] = useState<TeachConsoleProps["result"]>(null);
  const [companionStatus, setCompanionStatus] = useState<CompanionStatus>("not connected");
  const [companionPerms, setCompanionPerms] = useState<CompanionPermissions | null>(null);
  const [agentMode, setAgentMode] = useState<string | null>(null);
  const [thinking, setThinking] = useState(0);
  const [talking, setTalking] = useState(false);

  const loopRef = useRef<Loop | null>(null);
  const masteryRef = useRef<MasteryState>({});
  const monitorRef = useRef(true);
  const companionRef = useRef<CompanionTransport | null>(null);
  const shareRef = useRef(createShareFlow<CaptureHandle>(() => companionRef.current));
  const [host, setHost] = useState<TransportHost>("detecting");
  const shortcutFnRef = useRef<(a: ShortcutAction) => void>(() => {});
  const companionActivity = useRef<{ typing: boolean; idle_ms: number; at: number } | null>(null);
  const voiceModeRef = useRef(false);
  const talkingRef = useRef(false);

  const push = useCallback((speaker: TeachLine["speaker"], text: string) => {
    setTranscript((t) => [...t.slice(-49), { id: newId("line"), speaker, text }]);
    // Captions: tutor lines only; the learner's words are already in the panel.
    if (speaker === "tutor" && !loopRef.current?.paused) companionRef.current?.buddySay(text);
  }, []);

  const onLearner = useCallback(
    (text: string) => {
      const loop = loopRef.current;
      // Push-to-talk: the learner is asking the tutor a question, not answering a prediction.
      if (!loop?.awaiting || talkingRef.current) return;
      const step = loop.awaiting;
      loop.awaiting = null;
      masteryRef.current = recordPrediction(masteryRef.current, step.n, scorePrediction(text, step));
    },
    [],
  );

  const clientTools = useMemo<NonNullable<UseVoiceAgentOptions["clientTools"]>>(
    () => ({
      replay_moment: () => {
        setReplayOpen(true);
        return "ok";
      },
    }),
    [],
  );
  const onTranscript = useCallback<UseVoiceAgentOptions["onTranscript"]>(
    (e) => {
      push(e.speaker === "agent" ? "tutor" : "learner", e.text);
      if (e.speaker !== "agent") onLearner(e.text);
    },
    [push, onLearner],
  );
  const agent = useVoiceAgent({ role: "tutor", clientTools, onTranscript, onModeChange: setAgentMode });
  const agentRef = useRef(agent);
  useEffect(() => {
    agentRef.current = agent;
  });

  /** Voice turn when the tutor runs, else the line is shown in the transcript. */
  const say = useCallback(
    (turn: string, fallback: string) => {
      if (voiceModeRef.current) agentRef.current.promptTurn(turn);
      else push("tutor", fallback);
    },
    [push],
  );

  useEffect(() => {
    let live = true;
    loadPickerOptions(localMode).then(
      (opts) => {
        if (!live) return;
        setOptions(opts);
        setSelected(preselect(opts, sessionId));
      },
      (err) => live && setBanner(`Work Maps could not be loaded (${err instanceof Error ? err.message : String(err)}). Reload to try again.`),
    );
    return () => {
      live = false;
    };
  }, [localMode, sessionId]);

  useEffect(() => {
    if (!agentId || !selected) return;
    const key = `${agentId}:${selected}`;
    let live = true;
    void checkTeachSource(agentId, selected).then((error) => live && setSourceCheck({ key, error }));
    return () => {
      live = false;
    };
  }, [agentId, selected]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    loadWorkMap(selected).then(
      (m) => {
        if (!live) return;
        setWorkmap(m.workmap);
        setWorkmapSessionId(m.sessionId);
        setBanner(m.banner);
      },
      (err) => live && setBanner(`The Work Map could not be loaded (${err instanceof Error ? err.message : String(err)}). Reload to try again.`),
    );
    return () => {
      live = false;
    };
  }, [selected]);

  // Desktop companion: halo over any app plus typing/idle counts for the pause check. Selected in an effect
  // ("detecting" until then). Activity and chords are used only while a teach session runs.
  useEffect(() => {
    const t = transport ?? selectTransport();
    companionRef.current = t;
    const share = shareRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the transport is picked on the client only ("detecting" before).
    setHost(t.kind);
    const off = bindTeachTransport(t, {
      active: () => loopRef.current !== null,
      onStatus: (s, perms) => {
        setCompanionStatus(s);
        setCompanionPerms(perms);
        if (s !== "paired") loopRef.current?.engine.clearAll("disconnect");
      },
      onActivity: (a) => {
        companionActivity.current = { typing: a.typing, idle_ms: a.idle_ms, at: Date.now() };
      },
      onChord: (c) => {
        const loop = loopRef.current;
        if (SHORTCUT_LEARNING && loop && !loop.paused) loop.coach.noteChord(c.chord);
      },
      onShortcut: (a) => shortcutFnRef.current(a),
    });
    t.connect();
    return () => {
      loopRef.current?.engine.clearAll("unmount");
      share.stop();
      off();
      t.dispose();
      companionRef.current = null;
    };
  }, [transport]);

  function onIntervene(iv: Intervention) {
    const loop = loopRef.current;
    if (!loop) return;
    loop.lastStopAt = Date.now();
    masteryRef.current = recordStop(masteryRef.current, iv.step.n);
    setIntervention(iv);
    setReplayOpen(false);
    const pending = `${iv.pending.field} set to ${iv.pending.to}`;
    say(buildGuardrailStopTurn({ expert: iv.expert, step: iv.step, pending }), `${iv.say} "${iv.quote}"`);
  }

  /** Prediction prompt for the next step, only at a natural pause (same pause rule as the Capture ask gate). */
  function maybePredict(loop: Loop) {
    const next = loop.nextToAsk;
    if (!next || loop.awaiting || loop.paused || talkingRef.current || loop.engine.stats().active > 0) return;
    const c = companionActivity.current;
    const act = effectiveActivity({
      typing: false,
      speaking: false,
      silence_ms: Date.now() - loop.lastFrameChange,
      companion: c ? { typing: c.typing, idle_ms: c.idle_ms, fresh: Date.now() - c.at < COMPANION_STALE_MS } : undefined,
    });
    if (act.typing || act.silence_ms < MIN_SILENCE_MS || (voiceModeRef.current && agentRef.current.isSpeaking)) return;
    loop.nextToAsk = null;
    loop.awaiting = next;
    loop.predicted.add(next.n);
    say(buildPredictTurn(next), PREDICT_QUESTION);
    const rect = loop.lastRect.get(next.n) ?? (loop.step ? loop.lastRect.get(loop.step.n) : undefined);
    if (rect && monitorRef.current) companionRef.current?.buddyPoint({ id: `predict_${next.n}`, rect, style: "glance" });
  }

  function onScreenEvent(loop: Loop, ev: ScreenEvent) {
    loop.events.push(ev);
    const match = matchStep(ev, loop.workmap);
    if (match && ev.rect) loop.lastRect.set(match.step.n, ev.rect);
    if (match && match.step.n !== loop.step?.n) {
      loop.step = match.step;
      setCurrentStep(match.step);
      const next = loop.workmap.steps.find((s) => s.n > match.step.n);
      loop.nextToAsk = next && !loop.predicted.has(next.n) ? next : null;
    }
    void loop.engine.onEvent(ev, match);
    // Stops win: no hint while a stop is active or within the cooldown after one.
    const busy = loop.paused || loop.engine.stats().active > 0 || Date.now() - loop.lastStopAt < COOLDOWN_MS;
    const hint = SHORTCUT_LEARNING ? loop.coach.onEvent(ev, match?.step ?? loop.step, { busy }) : null;
    if (hint) say(hint.text, hint.text);
  }

  async function onFrame(loop: Loop, f: CapturedFrame) {
    if (loop.paused) return;
    maybePredict(loop);
    if (loop.visionBusy || !f.changed) return;
    loop.visionBusy = true;
    setThinking((n) => n + 1);
    try {
      const res = await postJson<{ events?: VisionEvent[]; frame_ref?: string }>("/api/vision", {
        session_id: loop.sessionId,
        t: f.t,
        frame: f.jpegBase64,
        previous: loop.events.slice(-8),
      });
      for (const e of res.events ?? []) onScreenEvent(loop, { ...e, id: newId("ev"), t: f.t, source: "vision", frame_ref: res.frame_ref });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setNotice(/429/.test(msg) ? "Daily vision limit reached: the tutor cannot see the screen any more today." : `Vision failed (${msg}).`);
    } finally {
      loop.visionBusy = false;
      setThinking((n) => Math.max(0, n - 1));
    }
  }

  async function start() {
    if (starting || loopRef.current || !workmap) return;
    setStarting(true);
    setNotice(null);
    setResult(null);
    const blocked = agentBlocker(agentLoad) ?? (agentId ? sourceError : null);
    if (blocked) {
      setNotice(blocked);
      setStarting(false);
      return;
    }
    let id: string;
    try {
      id = (await postJson<{ id: string }>("/api/session", teachSessionBody(agentId))).id;
    } catch (err) {
      setNotice(`Could not create the teach session: ${err instanceof Error ? err.message : String(err)}`);
      setStarting(false);
      return;
    }
    masteryRef.current = {};
    const engine = createInterventionEngine({
      workmap,
      decide: decideViaApi,
      // Halo rects map to the primary display only when the whole monitor is shared.
      companion: stopPointSink(() => companionRef.current, () => monitorRef.current),
      onIntervene,
      onClear: () => {
        setIntervention(null);
        setReplayOpen(false);
      },
      onChange: setStats,
    });
    loopRef.current = {
      sessionId: id,
      workmap,
      engine,
      t0: Date.now(),
      events: [],
      visionBusy: false,
      lastFrameChange: Date.now(),
      step: null,
      predicted: new Set(),
      awaiting: null,
      nextToAsk: workmap.steps[0] ?? null,
      paused: false,
      lastRect: new Map(),
      coach: createShortcutCoach({ workmap }),
      lastStopAt: -Infinity,
    };
    setRunning(true);
    // Voice first, so the mic prompt or a start error shows; in the desktop app the screen share is part of Start
    // (no picker) and the window steps aside only when voice runs.
    await startVoiceThenShare({
      startVoice: async () => {
        try {
          await agentRef.current.start({ dynamicVariables: { expert: workmap.expert, work_map: JSON.stringify(workmap) } });
          voiceModeRef.current = true;
          setTextMode(false);
          return true;
        } catch (err) {
          voiceModeRef.current = false;
          setTextMode(true);
          setNotice(`Voice did not start (${err instanceof Error ? err.message : String(err)}). Text mode: the tutor writes here.`);
          return false;
        }
      },
      inApp: companionRef.current?.kind === "bridge",
      share: (stepAside) => toggleShare(stepAside),
    });
    setStarting(false);
  }

  async function toggleShare(stepAside = true) {
    const loop = loopRef.current;
    if (!loop) return;
    const share = shareRef.current;
    const clear = () => {
      setSharing(false);
      setShareWarning(null);
      loop.engine.clearAll("pause");
    };
    if (share.handle()) {
      share.stop();
      clear();
      return;
    }
    try {
      const handle = await share.start(
        (onEnded) =>
          startScreenCapture({
            getT: () => (Date.now() - loop.t0) / 1000,
            onFrame: (f) => void onFrame(loop, f),
            onFrameChange: () => {
              loop.lastFrameChange = Date.now();
            },
            onEnded,
          }),
        { stepAside, onEnded: clear },
      );
      // Finished while getDisplayMedia was pending: the flow stopped the late handle, restored once, no step-aside.
      if (!handle) return;
      // Halo rects map to the primary display only when the whole monitor is shared.
      monitorRef.current = !handle.displaySurface || handle.displaySurface === "monitor";
      setSharing(true);
      setShareWarning(monitorRef.current ? null : MONITOR_WARNING);
    } catch (err) {
      setNotice(`Screen share not started (${err instanceof Error ? err.message : String(err)}).`);
    }
  }

  function togglePause() {
    const loop = loopRef.current;
    if (!loop) return;
    loop.paused = !loop.paused;
    if (loop.paused) {
      loop.engine.clearAll("pause");
      shareRef.current.handle()?.pause();
    } else shareRef.current.handle()?.resume();
    setPaused(loop.paused);
  }

  async function finish() {
    const loop = loopRef.current;
    if (!loop) return;
    loopRef.current = null;
    talkingRef.current = false;
    setTalking(false);
    loop.engine.clearAll("end");
    shareRef.current.stop();
    setSharing(false);
    setRunning(false);
    const s = summary(masteryRef.current, loop.workmap.steps);
    say(buildMasteryTurn(s.text), s.text);
    let saved = "Not saved: this Work Map has no session (sample).";
    if (workmapSessionId) {
      const teach = buildTeachProgress({
        workmapSessionId,
        state: masteryRef.current,
        steps: loop.workmap.steps,
        interventions: loop.engine.stats().interventions,
      });
      try {
        await postJson(`/api/session/${encodeURIComponent(loop.sessionId)}/teach`, { teach });
        saved = "Saved to this teach session.";
      } catch (err) {
        saved = `Not saved (${err instanceof Error ? err.message : String(err)}).`;
      }
    }
    void postJson(`/api/session/${encodeURIComponent(loop.sessionId)}/end`, {}).catch(() => {});
    setResult({ ...s, saved });
    if (voiceModeRef.current) setTimeout(() => void agentRef.current.stop(), 8000);
  }

  /** Push-to-talk from the companion: while held the learner asks the tutor; no prediction prompt fires. */
  function talk(held: boolean) {
    const loop = loopRef.current;
    if (!loop || loop.paused || talkingRef.current === held) return;
    talkingRef.current = held;
    setTalking(held);
    if (held && voiceModeRef.current) agentRef.current.noteUserActivity();
  }

  const shortcutRef = useRef(
    teachShortcutControls({ talk: () => {}, togglePause: () => {}, finish: () => {}, startedAt: () => null }),
  );
  useEffect(() => {
    shortcutRef.current = teachShortcutControls({
      talk,
      togglePause,
      finish: () => void finish(),
      startedAt: () => loopRef.current?.t0 ?? null,
    });
  });
  useEffect(() => {
    shortcutFnRef.current = (a) => routeShortcut(a, shortcutRef.current);
  }, []);

  const buddyState = buddyStateFor({
    active: running,
    paused,
    voiceStatus: textMode ? null : agent.status,
    mode: agentMode,
    pending: thinking,
    talking,
  });
  useEffect(() => {
    companionRef.current?.buddyState(buddyState);
  }, [buddyState, companionStatus]);

  const lastLine = (who: TeachLine["speaker"]) => [...transcript].reverse().find((l) => l.speaker === who)?.text ?? "";
  const lastQuestion = lastLine("tutor");
  const lastAnswer = lastLine("learner");
  useEffect(() => {
    companionRef.current?.sessionState({
      mode: running ? "teach" : null,
      title: workmap?.task ?? "Teach",
      expert: workmap?.expert ?? "",
      asked: loopRef.current?.predicted.size ?? 0,
      guardrails: stats.interventions,
      last_question: lastQuestion,
      last_answer: lastAnswer,
      off_record: paused,
      app_url: typeof window !== "undefined" ? window.location.href : "",
    });
  }, [running, workmap, stats.interventions, transcript, lastQuestion, lastAnswer, paused]);

  return (
    <>
    <AgentHeader load={agentLoad} state={running ? (paused ? "paused" : "listening") : "idle"} verb="teaching" />
    {agentId && sourceError && (
      <div role="alert" className="border-b border-line px-4 py-2 text-sm text-red-500">
        {sourceError}
      </div>
    )}
    <TeachConsole
      options={options}
      selected={selected}
      workmap={workmap}
      banner={banner}
      workmapSessionId={workmapSessionId}
      running={running}
      starting={starting}
      paused={paused}
      sharing={sharing}
      shareWarning={shareWarning}
      notice={notice}
      textMode={textMode}
      host={host}
      companion={{ status: companionStatus, permissions: companionPerms, onPair: (code) => companionRef.current?.pair(code) ?? false }}
      agentName={agentLoad.status === "ok" ? agentLoad.agent.name : null}
      currentStep={currentStep}
      transcript={transcript}
      intervention={intervention}
      replayOpen={replayOpen}
      stats={stats}
      result={result}
      onSelect={setSelected}
      onStart={() => void start()}
      onToggleShare={() => void toggleShare()}
      onTogglePause={togglePause}
      onEnd={() => void finish()}
      onReplay={() => setReplayOpen((o) => !o)}
      sendError={running ? textTurnError({ textMode, voiceStatus: agent.status }) : null}
      onAnswer={(text) => {
        sendTextTurn(text, { textMode, voiceStatus: agent.status, promptTurn: (t) => agentRef.current.promptTurn(t) }, push, onLearner);
      }}
    />
    </>
  );
}
