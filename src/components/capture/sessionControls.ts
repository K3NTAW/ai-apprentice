// Capture session controls (fix round T-0152). Two buttons, two meanings, as in Capture.dc.html:
// Pause holds the apprentice's live questions (capture, events and transcript continue);
// Off the record stops all capture. The clock behind the capturing pill restarts at 0 for every session.
import type { AskGate } from "@/lib/voice/askGate";
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
