"use client";

// Teach on real apps (pivot). The learner picks a confirmed Work Map, starts the tutor voice, shares the whole
// screen and pairs the desktop companion. Frames -> /api/vision events -> step match -> prediction prompts at
// natural pauses and guardrail stops by voice and companion halo before the save. Finish stores Session.teach.
// Rollback: revert this task's commit; the page then shows the previous placeholder.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startScreenCapture, type CaptureHandle, type CapturedFrame } from "@/lib/perception/capture";
import { createCompanionClient, type CompanionClient, type CompanionPermissions, type CompanionStatus } from "@/lib/companion/client";
import { COMPANION_STALE_MS, MIN_SILENCE_MS, effectiveActivity } from "@/lib/voice/askGate";
import { buildGuardrailStopTurn, buildMasteryTurn, buildPredictTurn } from "@/lib/voice/prompts";
import { useVoiceAgent, VoiceProvider, type UseVoiceAgentOptions } from "@/lib/voice/useVoiceAgent";
import { createInterventionEngine, decideViaApi, type Intervention, type InterventionEngine, type InterventionStats } from "@/lib/teach/intervention";
import { buildTeachProgress, recordPrediction, recordStop, scorePrediction, summary, type MasteryState } from "@/lib/teach/mastery";
import { matchStep } from "@/lib/teach/stepMatch";
import { newId, type ScreenEvent, type VisionEvent, type WorkMap, type WorkMapStep } from "@/lib/types";
import { loadPickerOptions, loadWorkMap, preselect, type PickerOption } from "./loadWorkMap";
import TeachConsole, { type TeachConsoleProps, type TeachLine } from "./TeachConsole";

export type TeachAppProps = { sessionId: string | null; localMode: boolean };

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

function TeachInner({ sessionId, localMode }: TeachAppProps) {
  const [options, setOptions] = useState<PickerOption[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
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

  const loopRef = useRef<Loop | null>(null);
  const masteryRef = useRef<MasteryState>({});
  const captureRef = useRef<CaptureHandle | null>(null);
  const monitorRef = useRef(true);
  const companionRef = useRef<CompanionClient | null>(null);
  const companionActivity = useRef<{ typing: boolean; idle_ms: number; at: number } | null>(null);
  const voiceModeRef = useRef(false);

  const push = useCallback((speaker: TeachLine["speaker"], text: string) => {
    setTranscript((t) => [...t.slice(-49), { id: newId("line"), speaker, text }]);
  }, []);

  const onLearner = useCallback(
    (text: string) => {
      const loop = loopRef.current;
      if (!loop?.awaiting) return;
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
  const agent = useVoiceAgent({ role: "tutor", clientTools, onTranscript });
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
    void loadPickerOptions(localMode).then((opts) => {
      if (!live) return;
      setOptions(opts);
      setSelected(preselect(opts, sessionId));
    });
    return () => {
      live = false;
    };
  }, [localMode, sessionId]);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    void loadWorkMap(selected).then((m) => {
      if (!live) return;
      setWorkmap(m.workmap);
      setWorkmapSessionId(m.sessionId);
      setBanner(m.banner);
    });
    return () => {
      live = false;
    };
  }, [selected]);

  // Desktop companion: halo over any app plus typing/idle counts for the pause check.
  useEffect(() => {
    const client = createCompanionClient();
    companionRef.current = client;
    const offs = [
      client.on("status", (s, perms) => {
        setCompanionStatus(s);
        setCompanionPerms(perms);
        if (s !== "paired") loopRef.current?.engine.clearAll("disconnect");
      }),
      client.on("activity", (a) => {
        companionActivity.current = { typing: a.typing, idle_ms: a.idle_ms, at: Date.now() };
      }),
    ];
    client.connect();
    return () => {
      loopRef.current?.engine.clearAll("unmount");
      captureRef.current?.stop();
      for (const off of offs) off();
      client.dispose();
      companionRef.current = null;
    };
  }, []);

  function onIntervene(iv: Intervention) {
    const loop = loopRef.current;
    if (!loop) return;
    masteryRef.current = recordStop(masteryRef.current, iv.step.n);
    setIntervention(iv);
    setReplayOpen(false);
    const pending = `${iv.pending.field} set to ${iv.pending.to}`;
    say(buildGuardrailStopTurn({ expert: iv.expert, step: iv.step, pending }), `${iv.say} "${iv.quote}"`);
  }

  /** Prediction prompt for the next step, only at a natural pause (same pause rule as the Capture ask gate). */
  function maybePredict(loop: Loop) {
    const next = loop.nextToAsk;
    if (!next || loop.awaiting || loop.paused || loop.engine.stats().active > 0) return;
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
  }

  function onScreenEvent(loop: Loop, ev: ScreenEvent) {
    loop.events.push(ev);
    const match = matchStep(ev, loop.workmap);
    if (match && match.step.n !== loop.step?.n) {
      loop.step = match.step;
      setCurrentStep(match.step);
      const next = loop.workmap.steps.find((s) => s.n > match.step.n);
      loop.nextToAsk = next && !loop.predicted.has(next.n) ? next : null;
    }
    void loop.engine.onEvent(ev, match);
  }

  async function onFrame(loop: Loop, f: CapturedFrame) {
    if (loop.paused) return;
    maybePredict(loop);
    if (loop.visionBusy || !f.changed) return;
    loop.visionBusy = true;
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
    }
  }

  async function start() {
    if (starting || loopRef.current || !workmap) return;
    setStarting(true);
    setNotice(null);
    setResult(null);
    let id: string;
    try {
      id = (await postJson<{ id: string }>("/api/session", { kind: "teach" })).id;
    } catch (err) {
      setNotice(`Could not create the teach session: ${err instanceof Error ? err.message : String(err)}`);
      setStarting(false);
      return;
    }
    masteryRef.current = {};
    const engine = createInterventionEngine({
      workmap,
      decide: decideViaApi,
      companion: {
        showHalo: (hid, rect, text) => monitorRef.current && (companionRef.current?.showHalo(hid, rect, text) ?? false),
        clearHalo: (hid) => companionRef.current?.clearHalo(hid) ?? false,
      },
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
    };
    setRunning(true);
    try {
      await agentRef.current.start({ dynamicVariables: { expert: workmap.expert, work_map: JSON.stringify(workmap) } });
      voiceModeRef.current = true;
      setTextMode(false);
    } catch (err) {
      voiceModeRef.current = false;
      setTextMode(true);
      setNotice(`Voice did not start (${err instanceof Error ? err.message : String(err)}). Text mode: the tutor writes here.`);
    }
    setStarting(false);
  }

  async function toggleShare() {
    const loop = loopRef.current;
    if (!loop) return;
    const clear = () => {
      captureRef.current = null;
      setSharing(false);
      setShareWarning(null);
      loop.engine.clearAll("pause");
    };
    if (captureRef.current) {
      captureRef.current.stop();
      clear();
      return;
    }
    try {
      const handle = await startScreenCapture({
        getT: () => (Date.now() - loop.t0) / 1000,
        onFrame: (f) => void onFrame(loop, f),
        onFrameChange: () => {
          loop.lastFrameChange = Date.now();
        },
        onEnded: () => {
          if (captureRef.current === handle) clear();
        },
      });
      captureRef.current = handle;
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
      captureRef.current?.pause();
    } else captureRef.current?.resume();
    setPaused(loop.paused);
  }

  async function finish() {
    const loop = loopRef.current;
    if (!loop) return;
    loopRef.current = null;
    loop.engine.clearAll("end");
    captureRef.current?.stop();
    captureRef.current = null;
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

  return (
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
      companion={{ status: companionStatus, permissions: companionPerms, onPair: (code) => companionRef.current?.pair(code) ?? false }}
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
      onAnswer={(text) => {
        push("learner", text);
        onLearner(text);
      }}
    />
  );
}
