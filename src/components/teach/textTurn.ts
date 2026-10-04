// Typed turn from the Teach composer (design V3). In voice mode the text goes to the tutor as a user message
// (useVoiceAgent.promptTurn = sendUserMessage); in text mode it is the learner's answer as before. A disconnected
// voice tutor never swallows the message: the composer is disabled and the error says why.

export type TextTurnTarget = {
  /** True when the tutor runs without voice (no signed url or mic): the answer is scored locally. */
  textMode: boolean;
  /** useVoiceAgent status: "connected" | "connecting" | "disconnected" | "disconnecting". */
  voiceStatus: string | null;
  promptTurn(text: string): void;
};

export const TUTOR_DISCONNECTED = "The tutor is not connected, so your message was not sent. Start the session again to talk to it.";

/** Null when typed turns can be sent now, else the reason shown under the input. */
export function textTurnError(target: Pick<TextTurnTarget, "textMode" | "voiceStatus">): string | null {
  if (target.textMode) return null;
  return target.voiceStatus === "connected" ? null : TUTOR_DISCONNECTED;
}

/**
 * Sends one typed turn. push shows it in the thread, onLearner feeds the mastery check (same as a spoken answer).
 * Returns false (nothing pushed, nothing sent) when the text is empty or the tutor is disconnected.
 */
export function sendTextTurn(
  raw: string,
  target: TextTurnTarget,
  push: (speaker: "learner", text: string) => void,
  onLearner: (text: string) => void,
): boolean {
  const text = raw.trim();
  if (!text || textTurnError(target)) return false;
  push("learner", text);
  onLearner(text);
  if (!target.textMode) target.promptTurn(text);
  return true;
}
