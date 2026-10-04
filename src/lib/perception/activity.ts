// Pure activity tracker for the ask_timing gate. Clock is injected (ms).

export type ActivitySnapshot = {
  typing: boolean;
  reading: boolean;
  speaking: boolean;
  silence_ms: number;
  /** Active ask cadence inputs (askGate activePause): time since speech ended, the last keystroke, the last frame change. */
  speech_silence_ms: number;
  typing_idle_ms: number;
  screen_stable_ms: number;
};

export const TYPING_WINDOW_MS = 1500;
export const READING_WINDOW_MS = 4000;

export function createActivityTracker({ now }: { now: () => number }) {
  const start = now();
  let lastKeystroke = -Infinity;
  let lastPointer = -Infinity;
  let lastFrameChange = -Infinity;
  let lastSpeechEnd = -Infinity;
  let speaking = false;

  return {
    noteKeystroke() {
      lastKeystroke = now();
    },
    notePointer() {
      lastPointer = now();
    },
    noteFrameChange() {
      lastFrameChange = now();
    },
    noteSpeech(active: boolean) {
      if (speaking && !active) lastSpeechEnd = now();
      speaking = active;
    },
    snapshot(): ActivitySnapshot {
      const t = now();
      const typing = t - lastKeystroke < TYPING_WINDOW_MS;
      const reading =
        !typing &&
        (t - lastFrameChange < READING_WINDOW_MS || t - lastPointer < READING_WINDOW_MS);
      const lastSound = Math.max(lastKeystroke, lastSpeechEnd, lastFrameChange, start);
      const since = (at: number) => Math.max(0, t - Math.max(at, start));
      return {
        typing,
        reading,
        speaking,
        silence_ms: speaking ? 0 : Math.max(0, t - lastSound),
        speech_silence_ms: speaking ? 0 : since(lastSpeechEnd),
        typing_idle_ms: since(lastKeystroke),
        screen_stable_ms: since(lastFrameChange),
      };
    },
  };
}

export type ActivityTracker = ReturnType<typeof createActivityTracker>;
