// Rebuild for /api/workmap under the 60 s route limit. Rescore only reuses the saved map; a full
// rebuild that runs past its budget falls back to the last saved map, rescored with the new answers.
import type { Session, WorkMap } from "@/lib/types";
import { scoreWorkMap } from "./score";
import type { ModelUsage } from "@/lib/perception/vision";
import { synthesizeWorkMap, type SynthesizeOptions } from "./synthesize";

/** Synthesis budget inside the 60 s route limit; the rest is left for scoring. */
export const FULL_REBUILD_BUDGET_MS = 40_000;

export type RebuildOptions = {
  rescoreOnly?: boolean;
  timeoutMs?: number;
  synthesize?: (session: Session, opts?: SynthesizeOptions) => Promise<WorkMap>;
  score?: (workmap: WorkMap, session: Session) => Promise<WorkMap>;
  /** Passed to every synthesize call; a callback after a lost race is ignored, a throw in it is swallowed. */
  onUsage?: (u: ModelUsage) => void;
};

export type RebuildResult = { workmap: WorkMap; mode: "rescore" | "full" | "fallback" };

const TIMED_OUT = Symbol("timeout");

export async function rebuildWorkMap(session: Session, opts: RebuildOptions = {}): Promise<RebuildResult> {
  const { synthesize = synthesizeWorkMap, score = scoreWorkMap, timeoutMs = FULL_REBUILD_BUDGET_MS } = opts;
  const last = session.workmap ?? null;
  // Set once the race is decided: usage reported later belongs to a map nobody uses and is not recorded.
  let settled = false;
  const onUsage = (u: ModelUsage) => {
    if (settled || !opts.onUsage) return;
    try {
      opts.onUsage(u);
    } catch {
      // Metering never changes the rebuild.
    }
  };
  if (opts.rescoreOnly && last) return { workmap: await score(last, session), mode: "rescore" };
  if (!last) return { workmap: await score(await synthesize(session, { onUsage }), session), mode: "full" };
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
    timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
  });
  let base: WorkMap | typeof TIMED_OUT;
  try {
    base = await Promise.race([synthesize(session, { onUsage }), timeout]);
  } catch (err) {
    console.warn("workmap: full rebuild failed, keeping the last map", err instanceof Error ? err.message : err);
    base = TIMED_OUT;
  } finally {
    settled = true;
    clearTimeout(timer);
  }
  if (base === TIMED_OUT) return { workmap: await score(last, session), mode: "fallback" };
  return { workmap: await score(base, session), mode: "full" };
}
