"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ConversationProvider,
  useConversation,
  type ClientTools,
  type MessagePayload,
  type Mode,
} from "@elevenlabs/react";

// Wraps the @elevenlabs/react conversation hook for the interviewer and tutor agents.
// SDK 1.x: useConversation must be rendered inside <ConversationProvider>; it is re-exported
// here as VoiceProvider so callers do not import the SDK directly.

export { ConversationProvider as VoiceProvider };

export type VoiceRole = "interviewer" | "tutor";
export type VoiceSpeaker = "expert" | "agent" | "learner";

export type UseVoiceAgentOptions = {
  role: VoiceRole;
  clientTools?: ClientTools;
  onTranscript: (e: { speaker: VoiceSpeaker; text: string }) => void;
  onModeChange?: (mode: Mode) => void;
  onError?: (message: string) => void;
};

export type StartOptions = {
  dynamicVariables?: Record<string, string | number | boolean>;
};

export function useVoiceAgent({ role, clientTools, onTranscript, onModeChange, onError }: UseVoiceAgentOptions) {
  const mutedRef = useRef(false);
  const [muted, setMutedState] = useState(false);
  const [startError, setStartError] = useState<string | null>(null);
  const toolsRef = useRef(clientTools);
  useEffect(() => {
    toolsRef.current = clientTools;
  }, [clientTools]);
  const humanSpeaker: VoiceSpeaker = role === "tutor" ? "learner" : "expert";

  const conversation = useConversation({
    micMuted: muted,
    onMessage: (msg: MessagePayload) => {
      if (mutedRef.current) return;
      const text = msg.message?.trim();
      if (!text) return;
      onTranscript({ speaker: msg.role === "agent" ? "agent" : humanSpeaker, text });
    },
    onModeChange: ({ mode }) => onModeChange?.(mode),
    onError: (message) => onError?.(message),
  });

  const start = useCallback(
    async (opts: StartOptions = {}) => {
      setStartError(null);
      try {
        const res = await fetch(`/api/voice/signed-url?role=${role}`, { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as { signed_url?: string; error?: string };
        if (!res.ok || !body.signed_url) throw new Error(body.error ?? `signed_url_${res.status}`);
        // Ask for the microphone up front so a denial surfaces here, then release it; the SDK opens its own stream.
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((t) => t.stop());
        conversation.startSession({
          signedUrl: body.signed_url,
          connectionType: "websocket",
          clientTools: toolsRef.current,
          dynamicVariables: opts.dynamicVariables,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStartError(message);
        onError?.(message);
        throw err;
      }
    },
    [conversation, role, onError],
  );

  const setMuted = useCallback(
    (value: boolean) => {
      mutedRef.current = value;
      setMutedState(value);
      conversation.setMuted(value);
    },
    [conversation],
  );

  return {
    start,
    stop: conversation.endSession,
    status: conversation.status,
    isSpeaking: conversation.isSpeaking,
    muted,
    startError,
    injectContext: conversation.sendContextualUpdate,
    promptTurn: conversation.sendUserMessage,
    noteUserActivity: conversation.sendUserActivity,
    setMuted,
  };
}

export type VoiceAgent = ReturnType<typeof useVoiceAgent>;
