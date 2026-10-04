// Buddy presence (protocol v2 buddy.state) from the voice agent and the work the page is waiting for.
import type { BuddyState } from "./client";

export type BuddyInput = {
  /** A Capture or Teach session is running. */
  active: boolean;
  /** Off the record (Capture) or paused (Teach). */
  paused: boolean;
  /** useVoiceAgent status: "connected" when the agent runs; anything else in text mode. */
  voiceStatus: string | null;
  /** useVoiceAgent mode: "speaking" | "listening". */
  mode: string | null;
  /** LLM, vision or decide results in flight. */
  pending: number;
  /** Push-to-talk held: the agent hears the user. */
  talking?: boolean;
};

/** paused > speaking > listening (push-to-talk) > thinking > listening > idle. */
export function buddyStateFor(i: BuddyInput): BuddyState {
  if (!i.active) return "idle";
  if (i.paused) return "paused";
  const voice = i.voiceStatus === "connected";
  if (voice && i.mode === "speaking") return "speaking";
  if (i.talking) return "listening";
  if (i.pending > 0) return "thinking";
  if (voice && i.mode === "listening") return "listening";
  return "idle";
}
