"use client";

// Capture page (pivot): a session console on the left watches the expert's real screen (any app);
// the voice side panel stays on the right. The desktop companion, when paired, adds typing/pointer
// activity and frontmost-app events, mirrors the session on its buddy and panel, and its shortcuts drive
// the controls. One-app D2: the companion is a transport (desktop app bridge, opt-in WebSocket or none); in the
// app Start also shares the screen without a picker and the window steps aside until End. Start order: the voice
// agent first (mic prompt, start error visible), then the share, then the step-aside only when voice runs. Voice is optional: when it cannot start, the loop runs in text mode and questions show in the panel.
import { intentQuery, type TrainIntent } from "@/lib/processes/train";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createActivityTracker } from "@/lib/perception/activity";
import { startScreenCapture, type CaptureHandle } from "@/lib/perception/capture";
import { createEventBus, type EventBus } from "@/lib/perception/eventBus";
import { createAskGate } from "@/lib/voice/askGate";
import { useVoiceAgent, VoiceProvider, type UseVoiceAgentOptions } from "@/lib/voice/useVoiceAgent";
import type { ScreenEvent } from "@/lib/types";
import {
  createCaptureController,
  fallbackQuestion,
  type CaptureCompanion,
  type CaptureController,
  type CaptureVoice,
} from "@/lib/capture/controller";
import { createCaptureSession, createHttpCaptureApi, endThenNavigate, loadAgent } from "@/lib/capture/httpApi";
import { buildSessionAgent } from "@/lib/companion/agentState";
import { SHORTCUT_LEARNING } from "@/lib/companion/chord";
import type { CompanionPermissions, CompanionStatus, ShortcutAction } from "@/lib/companion/client";
import { selectTransport, type CompanionTransport, type TransportHost } from "@/lib/companion/transport";
import { createShareFlow, startVoiceThenShare } from "@/lib/companion/stepAside";
import { bindCaptureTransport, captureCompanionSink } from "@/lib/capture/companionWiring";
import { routeShortcut } from "@/lib/companion/shortcuts";
import AgentAvatar from "@/components/agents/AgentAvatar";
import AgentHeader from "@/components/agents/AgentHeader";
import { agentBlocker, useAgent } from "@/components/agents/useAgent";
import { createAgentCaptureSession } from "./agentSession";
import CaptureConsole from "./CaptureConsole";
import { dailyLimitNotice, voiceStartNotice } from "./dailyLimit";
import SidePanel, { type PresenceStatus } from "./SidePanel";
import {
  askCadence,
  captureSettings,
  captureShortcuts,
  holdableGate,
  loadAgentSettings,
  sessionClock,
  ttsOverrideAllowed,
} from "./sessionControls";

type Loop = {
  ctrl: CaptureController;
  bus: EventBus;
  activity: ReturnType<typeof createActivityTracker>;
  getT: () => number;
  sessionId: string;
  startedAt: number;
};

type View = {
  asked: number;
  guardrailAsked: number;
  debrief: number;
  deciding: number;
  offRecord: boolean;
  visionFailures: number;
  feed: ScreenEvent[];
  lastQuestion: string | null;
  openQuestion: string | null;
  dailyLimit: string[];
};

const EMPTY: View = {
  asked: 0,
  guardrailAsked: 0,
  debrief: 0,
  deciding: 0,
  offRecord: false,
  visionFailures: 0,
  feed: [],
  lastQuestion: null,
  openQuestion: null,
  dailyLimit: [],
};

function viewOf(c: CaptureController): View {
  const s = c.stats();
  return {
    asked: s.asked,
    guardrailAsked: s.guardrailAsked,
    debrief: s.debrief,
    deciding: s.deciding,
    offRecord: s.offRecord,
    visionFailures: s.visionFailures,
    feed: c.feed(),
    lastQuestion: c.lastQuestion(),
    openQuestion: c.openQuestion(),
    dailyLimit: c.dailyLimit(),
  };
}

/** transport: injected for tests; otherwise selected on mount (bridge, opt-in WebSocket or none). */
// intent: ?process&mode from a process page (Add to this process, Retrain from scratch), passed on to the debrief.
export type CaptureAppProps = { agentParam?: string | null; transport?: CompanionTransport; intent?: TrainIntent | null };

export default function CaptureApp({ agentParam = null, transport, intent = null }: CaptureAppProps) {
  return (
    <VoiceProvider>
      <CaptureInner agentParam={agentParam} transport={transport} intent={intent} />
    </VoiceProvider>
  );
}

function CaptureInner({ agentParam, transport, intent }: { agentParam: string | null; transport?: CompanionTransport; intent: TrainIntent | null }) {
  const router = useRouter();
  const agentLoad = useAgent(agentParam);
  const [expert, setExpert] = useState("Sabine");
  const agentExpert = agentLoad.status === "ok" ? agentLoad.agent.expert_name?.trim() : undefined;
  // Adopt the agent's expert name when it loads or changes (state adjusted during render, not in an effect).
  const [seenAgentExpert, setSeenAgentExpert] = useState<string | undefined>(undefined);
  if (agentExpert !== seenAgentExpert) {
    setSeenAgentExpert(agentExpert);
    if (agentExpert) setExpert(agentExpert);
  }
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<string>("listening");
  const [sharing, setSharing] = useState(false);
  const [view, setView] = useState<View>(EMPTY);
  const loopRef = useRef<Loop | null>(null);
  const voiceModeRef = useRef(false);
  const companionRef = useRef<CompanionTransport | null>(null);
  const shareRef = useRef(createShareFlow<CaptureHandle>(() => companionRef.current));
  const [host, setHost] = useState<TransportHost>("detecting");
  const shortcutRef = useRef<(a: ShortcutAction) => void>(() => {});
  const [companionStatus, setCompanionStatus] = useState<CompanionStatus>("not connected");
  const [companionPerms, setCompanionPerms] = useState<CompanionPermissions | null>(null);
  const [shareWarning, setShareWarning] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const clockRef = useRef(sessionClock(setElapsed));
  // Pause: the apprentice holds its live questions; capture continues (Off the record stops capture).
  const [questionsPaused, setQuestionsPaused] = useState(false);
  const holdRef = useRef(false);

  // The capturing pill's mm:ss, ticking once a second while the session runs.
  useEffect(() => {
    if (!running) return;
    const clock = clockRef.current;
    const id = setInterval(() => clock.tick(), 1000);
    return () => clearInterval(id);
  }, [running]);

  const clientTools = useMemo<NonNullable<UseVoiceAgentOptions["clientTools"]>>(
    () => ({
      set_off_record: (p) => {
        loopRef.current?.ctrl.setOffRecord(Boolean(p.active));
        return "ok";
      },
    }),
    [],
  );
  const onTranscript = useCallback<UseVoiceAgentOptions["onTranscript"]>(
    (e) => loopRef.current?.ctrl.onTranscript(e.speaker, e.text),
    [],
  );
  // Speech-aware timing: the SDK's VAD score drives the tracker's speaking flag (600 ms release).
  const onVadScore = useCallback((score: number) => loopRef.current?.activity.noteVad(score), []);
  const agent = useVoiceAgent({ role: "interviewer", clientTools, onTranscript, onModeChange: setAgentMode, onVadScore });
  const agentRef = useRef(agent);
  useEffect(() => {
    agentRef.current = agent;
  });

  // Desktop companion: optional. Selected in an effect ("detecting" until then, so SSR never shows the browser
  // panel inside the app). Its activity and app events reach the controller only while a session runs;
  // the controller drops them while off the record.
  useEffect(() => {
    const t = transport ?? selectTransport();
    companionRef.current = t;
    const share = shareRef.current;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- the transport is picked on the client only ("detecting" before).
    setHost(t.kind);
    const off = bindCaptureTransport(t, {
      ctrl: () => loopRef.current?.ctrl ?? null,
      onStatus: (s, perms) => {
        setCompanionStatus(s);
        setCompanionPerms(perms);
      },
      onShortcut: (a) => shortcutRef.current(a),
    });
    t.connect();
    return () => {
      share.stop();
      off();
      t.dispose();
      companionRef.current = null;
    };
  }, [transport]);

  useEffect(() => {
    loopRef.current?.ctrl.setAgent({ status: textMode ? null : agent.status, mode: textMode ? null : agentMode });
  }, [agent.status, agentMode, textMode, running]);

  useEffect(() => {
    const share = shareRef.current;
    return () => {
      loopRef.current?.ctrl.stop();
      share.stop();
    };
  }, []);

  async function start() {
    if (starting || loopRef.current) return;
    setStarting(true);
    setNotice(null);
    const blocked = agentBlocker(agentLoad);
    if (blocked) {
      setNotice(blocked);
      setStarting(false);
      return;
    }
    const name = expert.trim() || "Sabine";
    // The agent this capture trains: ?agent=<id>, linked on the session and shown in the companion dock.
    const agentId = SHORTCUT_LEARNING ? new URLSearchParams(window.location.search).get("agent") : null;
    let sessionId: string;
    try {
      sessionId =
        agentLoad.status === "ok"
          ? await createAgentCaptureSession(name, agentLoad.agent.id)
          : await createCaptureSession(name, agentId);
    } catch (err) {
      setNotice(`Could not create the session: ${err instanceof Error ? err.message : String(err)}`);
      setStarting(false);
      return;
    }
    const t0 = Date.now();
    const getT = () => (Date.now() - t0) / 1000;
    const bus = createEventBus({ now: getT });
    const activity = createActivityTracker({ now: Date.now });
    // Agent Settings, read once: minimum gap (default 60 s; cap 8 per 10 min) and guardrails first for the gate,
    // the off-record phrase and shortcut learning for the controller, voice overrides at session start.
    const wired = captureSettings(
      await loadAgentSettings(agentLoad.status === "ok" ? agentLoad.agent.id : agentId),
      ttsOverrideAllowed(process.env.NEXT_PUBLIC_TTS_OVERRIDES),
    );
    const gate = holdableGate(
      createAskGate({ now: Date.now, cadence: askCadence(process.env.NEXT_PUBLIC_ASK_CADENCE), ...wired.gate }),
      () => holdRef.current,
    );
    const voice: CaptureVoice = {
      promptTurn: (text, meta) => {
        if (voiceModeRef.current) agentRef.current.promptTurn(text);
        else {
          const q = fallbackQuestion(meta.event, meta.ask);
          queueMicrotask(() => loopRef.current?.ctrl.onTranscript("agent", q));
        }
      },
      injectContext: (text) => {
        if (voiceModeRef.current) agentRef.current.injectContext(text);
      },
      noteUserActivity: () => {
        if (voiceModeRef.current) agentRef.current.noteUserActivity();
      },
      setMuted: (m) => {
        if (voiceModeRef.current) agentRef.current.setMuted(m);
      },
      isSpeaking: () => voiceModeRef.current && agentRef.current.isSpeaking,
    };
    // Reads the ref on every call: the transport may be re-created while the session runs.
    const buddy: CaptureCompanion = captureCompanionSink(() => companionRef.current);
    // Agent missing or avatar render failed: session.state goes out without an agent (logged once).
    const sessionAgent = buildSessionAgent(await loadAgent(agentId));
    const ctrl = createCaptureController({
      api: createHttpCaptureApi(sessionId, () => bus.all()),
      voice,
      bus,
      activity,
      gate,
      now: Date.now,
      sessionId,
      getT,
      onChange: () => setView(viewOf(ctrl)),
      onError: (where, err) => console.warn(`capture: ${where} failed`, err),
      companion: buddy,
      session: { expert: name, appUrl: window.location.href },
      agent: sessionAgent,
      ...wired.controller,
    });
    loopRef.current = { ctrl, bus, activity, getT, sessionId, startedAt: t0 };
    holdRef.current = false;
    setQuestionsPaused(false);
    clockRef.current.start(getT);
    ctrl.start();
    setRunning(true);

    // Voice first, so the mic prompt or a start error shows; in the desktop app the screen share is part of Start
    // (no picker) and the window steps aside only when voice runs.
    await startVoiceThenShare({
      startVoice: async () => {
        try {
          await agentRef.current.start({ dynamicVariables: { expert: name }, overrides: wired.voice.overrides });
          if (wired.voice.notice) console.info(`capture: ${wired.voice.notice}`);
          voiceModeRef.current = true;
          setTextMode(false);
          return true;
        } catch (err) {
          voiceModeRef.current = false;
          setTextMode(true);
          setNotice(
            voiceStartNotice(
              err instanceof Error ? err.message : String(err),
              "Text mode: questions appear here, type your answers below.",
            ),
          );
          return false;
        }
      },
      inApp: companionRef.current?.kind === "bridge",
      share: (stepAside) => toggleShare(stepAside),
    });
    setStarting(false);
  }

  function toggleOffRecord() {
    const ctrl = loopRef.current?.ctrl;
    if (ctrl) ctrl.setOffRecord(!ctrl.isOffRecord());
  }

  function toggleQuestions() {
    if (!loopRef.current) return;
    holdRef.current = !holdRef.current;
    setQuestionsPaused(holdRef.current);
  }

  async function toggleShare(stepAside = true) {
    const loop = loopRef.current;
    if (!loop) return;
    const share = shareRef.current;
    const clear = () => {
      loop.ctrl.setCapture(null);
      setSharing(false);
      setShareWarning(null);
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
            getT: loop.getT,
            onFrame: (f) => void loop.ctrl.onFrame(f),
            onFrameChange: () => loop.activity.noteFrameChange(),
            // Stopped from the browser's own "Stop sharing" bar (or the app's stream ended): the flow restores.
            onEnded,
          }),
        { stepAside, onEnded: clear },
      );
      // Ended while getDisplayMedia was pending: the flow stopped the late handle and restored the window.
      if (!handle) return;
      loop.ctrl.setCapture(handle);
      setSharing(true);
      setShareWarning(
        handle.displaySurface && handle.displaySurface !== "monitor"
          ? "You shared a window or tab, not the whole screen. Capture only sees that part and halo placement will be off. Stop sharing and pick the entire screen."
          : null,
      );
    } catch (err) {
      setNotice(
        `Screen share not started (${err instanceof Error ? err.message : String(err)}). Capture still works from speech and the desktop companion.`,
      );
    }
  }

  async function endTask() {
    const loop = loopRef.current;
    if (!loop) return;
    // A share still pending (Start in progress) is cancelled and never steps aside.
    loopRef.current = null;
    loop.ctrl.stop();
    clockRef.current.stop();
    holdRef.current = false;
    setQuestionsPaused(false);
    shareRef.current.stop();
    setSharing(false);
    setShareWarning(null);
    if (voiceModeRef.current) void agentRef.current.stop();
    // Mark the session ended before the debrief, so the sidebar stops showing it as live.
    await endThenNavigate(loop.sessionId, () => router.push(`/debrief/${loop.sessionId}${intentQuery(intent)}`));
  }

  // Companion shortcuts call the same controls as the buttons: pause_toggle holds questions, off_record_toggle stops capture.
  useEffect(() => {
    shortcutRef.current = (a) =>
      routeShortcut(
        a,
        captureShortcuts({
          talk: (held) => loopRef.current?.ctrl.setTalking(held),
          toggleQuestions,
          toggleOffRecord,
          endTask: () => void endTask(),
          startedAt: () => loopRef.current?.startedAt ?? null,
        }),
      );
  });

  const status: PresenceStatus = !running
    ? "idle"
    : view.offRecord
      ? "paused"
      : !textMode && agentMode === "speaking"
        ? "speaking"
        : view.deciding > 0
          ? "thinking"
          : "listening";

  const loaded = agentLoad.status === "ok" ? agentLoad.agent : null;
  return (
    <>
      {/* Only the unknown-agent or loading notice: the console header names the agent (Capture.dc.html). */}
      {!loaded && <AgentHeader load={agentLoad} verb="training" />}
      <CaptureConsole
        running={running}
        starting={starting}
        offRecord={view.offRecord}
        questionsPaused={questionsPaused}
        sharing={sharing}
        shareWarning={shareWarning}
        expert={expert}
        agentName={loaded?.name ?? null}
        avatar={loaded ? <AgentAvatar avatar={loaded.avatar} state={running ? "listening" : "idle"} size={96} /> : undefined}
        elapsed={running ? elapsed : undefined}
        lastQuestion={view.lastQuestion}
        asked={view.asked}
        guardrailAsked={view.guardrailAsked}
        savedForDebrief={view.debrief}
        visionFailures={view.visionFailures}
        feed={view.feed}
        host={host}
        companion={{
          status: companionStatus,
          permissions: companionPerms,
          onPair: (code) => companionRef.current?.pair(code) ?? false,
        }}
        onExpertChange={setExpert}
        onStart={() => void start()}
        onEnd={() => void endTask()}
        onTogglePause={toggleQuestions}
        onToggleOffRecord={toggleOffRecord}
        onToggleShare={() => void toggleShare()}
      >
        <SidePanel
          status={status}
          running={running}
          starting={starting}
          offRecord={view.offRecord}
          textMode={textMode}
          sharing={sharing}
          notice={notice}
          limitNotice={dailyLimitNotice(view.dailyLimit)}
          expert={expert}
          lastQuestion={view.lastQuestion}
          openQuestion={view.openQuestion}
          asked={view.asked}
          guardrailAsked={view.guardrailAsked}
          savedForDebrief={view.debrief}
          feed={view.feed}
          onExpertChange={setExpert}
          onStart={() => void start()}
          onEnd={() => void endTask()}
          onTogglePause={toggleOffRecord}
          onToggleShare={() => void toggleShare()}
          onAnswer={(text) => loopRef.current?.ctrl.onTranscript("expert", text)}
          hideControls
        />
      </CaptureConsole>
    </>
  );
}
