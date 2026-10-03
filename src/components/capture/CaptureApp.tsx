"use client";

// Capture page (pivot): a session console on the left watches the expert's real screen (any app);
// the voice side panel stays on the right. The desktop companion, when paired, adds typing/pointer
// activity and frontmost-app events. Voice is optional: when it cannot start, the loop runs in text mode and questions show in the panel.
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
  type CaptureController,
  type CaptureVoice,
} from "@/lib/capture/controller";
import { createCaptureSession, createHttpCaptureApi } from "@/lib/capture/httpApi";
import {
  createCompanionClient,
  type CompanionClient,
  type CompanionPermissions,
  type CompanionStatus,
} from "@/lib/companion/client";
import CaptureConsole from "./CaptureConsole";
import { dailyLimitNotice, voiceStartNotice } from "./dailyLimit";
import SidePanel, { type PresenceStatus } from "./SidePanel";

type Loop = {
  ctrl: CaptureController;
  bus: EventBus;
  activity: ReturnType<typeof createActivityTracker>;
  getT: () => number;
  sessionId: string;
};

type View = {
  asked: number;
  guardrailAsked: number;
  debrief: number;
  deciding: number;
  offRecord: boolean;
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
    feed: c.feed(),
    lastQuestion: c.lastQuestion(),
    openQuestion: c.openQuestion(),
    dailyLimit: c.dailyLimit(),
  };
}

export default function CaptureApp() {
  return (
    <VoiceProvider>
      <CaptureInner />
    </VoiceProvider>
  );
}

function CaptureInner() {
  const router = useRouter();
  const [expert, setExpert] = useState("Sabine");
  const [running, setRunning] = useState(false);
  const [starting, setStarting] = useState(false);
  const [textMode, setTextMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [agentMode, setAgentMode] = useState<string>("listening");
  const [sharing, setSharing] = useState(false);
  const [view, setView] = useState<View>(EMPTY);
  const loopRef = useRef<Loop | null>(null);
  const voiceModeRef = useRef(false);
  const captureRef = useRef<CaptureHandle | null>(null);
  const companionRef = useRef<CompanionClient | null>(null);
  const [companionStatus, setCompanionStatus] = useState<CompanionStatus>("not connected");
  const [companionPerms, setCompanionPerms] = useState<CompanionPermissions | null>(null);
  const [shareWarning, setShareWarning] = useState<string | null>(null);

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
  const agent = useVoiceAgent({ role: "interviewer", clientTools, onTranscript, onModeChange: setAgentMode });
  const agentRef = useRef(agent);
  useEffect(() => {
    agentRef.current = agent;
  });

  // Desktop companion: optional. Its activity and app events reach the controller only while a session runs;
  // the controller drops them while off the record.
  useEffect(() => {
    const client = createCompanionClient();
    companionRef.current = client;
    const offs = [
      client.on("status", (s, perms) => {
        setCompanionStatus(s);
        setCompanionPerms(perms);
        if (s !== "paired") loopRef.current?.ctrl.onCompanionDisconnected();
      }),
      client.on("activity", (a) => loopRef.current?.ctrl.onCompanionActivity(a)),
      client.on("app", (a) => loopRef.current?.ctrl.onCompanionApp(a)),
    ];
    client.connect();
    return () => {
      for (const off of offs) off();
      client.dispose();
      companionRef.current = null;
    };
  }, []);

  useEffect(
    () => () => {
      loopRef.current?.ctrl.stop();
      captureRef.current?.stop();
    },
    [],
  );

  async function start() {
    if (starting || loopRef.current) return;
    setStarting(true);
    setNotice(null);
    const name = expert.trim() || "Sabine";
    let sessionId: string;
    try {
      sessionId = await createCaptureSession(name);
    } catch (err) {
      setNotice(`Could not create the session: ${err instanceof Error ? err.message : String(err)}`);
      setStarting(false);
      return;
    }
    const t0 = Date.now();
    const getT = () => (Date.now() - t0) / 1000;
    const bus = createEventBus({ now: getT });
    const activity = createActivityTracker({ now: Date.now });
    const gate = createAskGate({ now: Date.now });
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
    });
    loopRef.current = { ctrl, bus, activity, getT, sessionId };
    ctrl.start();
    setRunning(true);

    try {
      await agentRef.current.start({ dynamicVariables: { expert: name } });
      voiceModeRef.current = true;
      setTextMode(false);
    } catch (err) {
      voiceModeRef.current = false;
      setTextMode(true);
      setNotice(
        voiceStartNotice(
          err instanceof Error ? err.message : String(err),
          "Text mode: questions appear here, type your answers below.",
        ),
      );
    }
    setStarting(false);
  }

  function togglePause() {
    const ctrl = loopRef.current?.ctrl;
    if (ctrl) ctrl.setOffRecord(!ctrl.isOffRecord());
  }

  async function toggleShare() {
    const loop = loopRef.current;
    if (!loop) return;
    const clear = () => {
      captureRef.current = null;
      loop.ctrl.setCapture(null);
      setSharing(false);
      setShareWarning(null);
    };
    if (captureRef.current) {
      captureRef.current.stop();
      clear();
      return;
    }
    try {
      const handle = await startScreenCapture({
        getT: loop.getT,
        onFrame: (f) => void loop.ctrl.onFrame(f),
        onFrameChange: () => loop.activity.noteFrameChange(),
        // Stopped from the browser's own "Stop sharing" bar.
        onEnded: () => {
          if (captureRef.current === handle) clear();
        },
      });
      captureRef.current = handle;
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

  function endTask() {
    const loop = loopRef.current;
    if (!loop) return;
    loop.ctrl.stop();
    captureRef.current?.stop();
    captureRef.current = null;
    setSharing(false);
    setShareWarning(null);
    if (voiceModeRef.current) void agentRef.current.stop();
    router.push(`/debrief/${loop.sessionId}`);
  }

  const status: PresenceStatus = !running
    ? "idle"
    : view.offRecord
      ? "paused"
      : !textMode && agentMode === "speaking"
        ? "speaking"
        : view.deciding > 0
          ? "thinking"
          : "listening";

  return (
    <main className="flex h-screen bg-slate-100">
      <div className="min-w-0 flex-1 overflow-auto p-4">
        <CaptureConsole
          running={running}
          starting={starting}
          offRecord={view.offRecord}
          sharing={sharing}
          shareWarning={shareWarning}
          expert={expert}
          lastQuestion={view.lastQuestion}
          asked={view.asked}
          guardrailAsked={view.guardrailAsked}
          savedForDebrief={view.debrief}
          feed={view.feed}
          companion={{
            status: companionStatus,
            permissions: companionPerms,
            onPair: (code) => companionRef.current?.pair(code) ?? false,
          }}
          onExpertChange={setExpert}
          onStart={() => void start()}
          onEnd={endTask}
          onTogglePause={togglePause}
          onToggleShare={() => void toggleShare()}
        />
      </div>
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
        onEnd={endTask}
        onTogglePause={togglePause}
        onToggleShare={() => void toggleShare()}
        onAnswer={(text) => loopRef.current?.ctrl.onTranscript("expert", text)}
        hideControls
      />
    </main>
  );
}
