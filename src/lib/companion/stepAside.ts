// Desktop app screen share (one-app D2). Start runs the existing startScreenCapture unchanged (its
// getDisplayMedia({ video: { displaySurface: "monitor" } }) is answered by the app's display media handler with
// the primary screen, which reports displaySurface "monitor"), and only after it resolves the window steps aside.
// restore() is idempotent: it sends window('restore') once per share started in the app (a share still pending
// is cancelled, so a late getDisplayMedia never steps aside) and is safe to call on end, finish, error, stream
// end, a rejected getDisplayMedia and unmount.
// Start order in the app (fix round T-0123): the voice agent first, so a mic prompt or a start error is visible,
// then the share, then the step-aside only when the agent is up.
import type { CompanionTransport } from "./transport";

export type StepAside = {
  /**
   * Runs begin(); on success, inside the app, with stepAside (default true) and not cancelled by restore() in the
   * meantime, sends window('step-aside'). A rejection is rethrown, no step-aside.
   */
  share<T>(begin: () => Promise<T>, opts?: { stepAside?: boolean }): Promise<T>;
  restore(): boolean;
  isAside(): boolean;
  /** True when restore() ran while the last share was pending. */
  cancelled(): boolean;
};

export function createStepAside(transport: () => CompanionTransport | null): StepAside {
  // owed: a share started in the app with step-aside intent; restore() then sends window('restore') once, also
  // when getDisplayMedia was rejected or the share was cancelled while pending.
  let owed = false;
  let aside = false;
  let pending = 0;
  let gen = 0;
  let cancelledGen = -1;
  return {
    async share(begin, { stepAside = true } = {}) {
      const my = ++gen;
      if (stepAside && transport()?.kind === "bridge") owed = true;
      pending++;
      try {
        const handle = await begin();
        const t = transport();
        if (stepAside && cancelledGen !== my && t?.kind === "bridge" && t.window("step-aside")) {
          aside = true;
          owed = true;
        }
        return handle;
      } finally {
        pending--;
      }
    },
    restore() {
      if (pending > 0) cancelledGen = gen;
      if (!owed && !aside) return false;
      owed = false;
      aside = false;
      transport()?.window("restore");
      return true;
    },
    isAside: () => aside,
    cancelled: () => cancelledGen === gen,
  };
}

export type ShareHandle = { stop(): void };

/** One screen share with its step-aside: the handle, the stream's own end and the cancel on stop. */
export type ShareFlow<H extends ShareHandle> = {
  /**
   * begin gets the onEnded to pass to startScreenCapture. Resolves the handle, or null when stop() ran while
   * begin was pending (the late handle is stopped, the window never steps aside). On rejection the window is
   * restored and the error rethrown. When the stream ends by itself, the flow restores and calls opts.onEnded.
   */
  start(begin: (onEnded: () => void) => Promise<H>, opts?: { stepAside?: boolean; onEnded?: () => void }): Promise<H | null>;
  /** Stops the handle, cancels a pending start and restores the window. Idempotent. */
  stop(): void;
  handle(): H | null;
  isAside(): boolean;
};

export function createShareFlow<H extends ShareHandle>(transport: () => CompanionTransport | null): ShareFlow<H> {
  const sa = createStepAside(transport);
  let current: H | null = null;
  let token = 0;
  const flow: ShareFlow<H> = {
    async start(begin, { stepAside = true, onEnded } = {}) {
      const my = ++token;
      let handle: H | null = null;
      const ended = () => {
        if (!handle || current !== handle) return;
        current = null;
        sa.restore();
        onEnded?.();
      };
      try {
        handle = await sa.share(() => begin(ended), { stepAside });
      } catch (err) {
        sa.restore();
        throw err;
      }
      if (my !== token) {
        // Stopped while getDisplayMedia was pending.
        handle.stop();
        sa.restore();
        return null;
      }
      current = handle;
      return handle;
    },
    stop() {
      token++;
      const h = current;
      current = null;
      h?.stop();
      sa.restore();
    },
    handle: () => current,
    isAside: () => sa.isAside(),
  };
  return flow;
}

/**
 * Start order: the voice agent first; in the app then the share, stepping aside only when the agent is up (on a
 * voice failure the window stays in front, so the error and the text mode stay visible). Returns whether voice runs.
 */
export async function startVoiceThenShare({
  startVoice,
  inApp,
  share,
}: {
  startVoice: () => Promise<boolean>;
  inApp: boolean;
  share: (stepAside: boolean) => Promise<unknown>;
}): Promise<boolean> {
  const voice = await startVoice();
  if (inApp) await share(voice);
  return voice;
}
