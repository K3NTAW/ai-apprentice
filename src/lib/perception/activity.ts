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
/** Voice activity: speaking while the VAD score is above VAD_THRESHOLD, released VAD_RELEASE_MS after the last such score. */
export const VAD_THRESHOLD = 0.5;
export const VAD_RELEASE_MS = 600;

export function createActivityTracker({ now }: { now: () => number }) {
  const start = now();
  let lastKeystroke = -Infinity;
  let lastPointer = -Infinity;
  let lastFrameChange = -Infinity;
  // noteSpeech (explicit on/off) and the VAD signal; either one makes the user speak.
  let manualEnd = -Infinity;
  let manual = false;
  let lastVoice = -Infinity;

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
      if (manual && !active) manualEnd = now();
      manual = active;
    },
    /** One VAD score from the voice SDK (0..1). */
    noteVad(score: number) {
      if (score > VAD_THRESHOLD) lastVoice = now();
    },
    snapshot(): ActivitySnapshot {
      const t = now();
      const voiced = t - lastVoice < VAD_RELEASE_MS;
      const speaking = manual || voiced;
      const lastSpeechEnd = Math.max(manualEnd, voiced ? -Infinity : lastVoice + VAD_RELEASE_MS);
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
