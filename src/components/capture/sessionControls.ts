// Capture session controls (fix round T-0152). Two buttons, two meanings, as in Capture.dc.html:
// Pause holds the apprentice's live questions (capture, events and transcript continue);
// Off the record stops all capture. The clock behind the capturing pill restarts at 0 for every session.
import type { AskCadence, AskGate } from "@/lib/voice/askGate";
import { DEFAULT_SETTINGS, resolveSettings, type AgentSettings } from "@/lib/agents/settings";
import type { ShortcutControls } from "@/lib/companion/shortcuts";

/** The ask gate with a hold: while held nothing is asked; events wait in the queue and are considered on resume. */
export function holdableGate(gate: AskGate, held: () => boolean): AskGate {
  return {
    ...gate,
    consider: (input) => (held() ? { action: "wait", why: "paused" } : gate.consider(input)),
    nextReady: (activity) => (held() ? null : gate.nextReady(activity)),
  };
}

/** Elapsed seconds for the capturing pill: read on start, 0 after stop, so a second session never shows the old time. */
export function sessionClock(set: (seconds: number) => void) {
  let read: (() => number) | null = null;
  return {
    start(getT: () => number) {
      read = getT;
      set(getT());
    },
    tick() {
      if (read) set(read());
    },
    stop() {
      read = null;
      set(0);
    },
  };
}

/** Companion shortcuts: pause_toggle holds questions, off_record_toggle stops capture (the buttons' meanings). */
export function captureShortcuts(c: {
  talk(held: boolean): void;
  toggleQuestions(): void;
  toggleOffRecord(): void;
  endTask(): void;
  startedAt(): number | null;
}): ShortcutControls {
  return { talk: c.talk, togglePause: c.toggleQuestions, toggleOffRecord: c.toggleOffRecord, endTask: c.endTask, startedAt: c.startedAt };
}

/** Rollback switch for the ask cadence: NEXT_PUBLIC_ASK_CADENCE=classic is the old 'ask less, later' gate. */
export function askCadence(env: string | undefined): AskCadence {
  return env?.trim().toLowerCase() === "classic" ? "classic" : "active";
}

/** The agent's settings for this session (read once at start); defaults when the fetch fails (logged). */
export async function loadAgentSettings(agentId: string | null, fetchImpl: typeof fetch = fetch): Promise<AgentSettings> {
  if (!agentId) return DEFAULT_SETTINGS;
  try {
    const res = await fetchImpl(`/api/agents/${encodeURIComponent(agentId)}/settings`, { cache: "no-store" });
    if (!res.ok) throw new Error(`settings ${res.status}`);
    const body = (await res.json()) as { settings?: unknown };
    return resolveSettings(body.settings);
  } catch (err) {
    console.warn("capture: agent settings unavailable, using defaults", err instanceof Error ? err.message : err);
    return DEFAULT_SETTINGS;
  }
}
