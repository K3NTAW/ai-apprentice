// Desktop app screen share (one-app D2). Start runs the existing startScreenCapture unchanged (its
// getDisplayMedia({ video: { displaySurface: "monitor" } }) is answered by the app's display media handler with
// the primary screen, which reports displaySurface "monitor"), and only after it resolves the window steps aside.
// restore() is idempotent: it sends window('restore') once per step-aside and is safe to call on end, finish,
// error, stream end, a rejected getDisplayMedia (nothing was sent then) and unmount.
import type { CompanionTransport } from "./transport";

export type StepAside = {
  /** Runs begin(); on success and inside the app sends window('step-aside'). A rejection is rethrown, nothing sent. */
  share<T>(begin: () => Promise<T>): Promise<T>;
  restore(): boolean;
  isAside(): boolean;
};

export function createStepAside(transport: () => CompanionTransport | null): StepAside {
  let aside = false;
  return {
    async share(begin) {
      const handle = await begin();
      const t = transport();
      if (t?.kind === "bridge" && t.window("step-aside")) aside = true;
      return handle;
    },
    restore() {
      if (!aside) return false;
      aside = false;
      transport()?.window("restore");
      return true;
    },
    isAside: () => aside,
  };
}
