// Matches a screen event to a Work Map step by app, object and action (field).
// Contract: (event, workmap) -> { step, confidence } or null. No match never falls back to a default step.
// Events on the app's own surfaces (SELF_SURFACES) are ignored.
import { SELF_SURFACES } from "@/lib/perception/vision";
import type { ScreenEvent, WorkMap, WorkMapStep } from "@/lib/types";

export type StepMatch = { step: WorkMapStep; confidence: number };

/** Below this the event is not tied to any step. */
export const MATCH_MIN = 0.5;
const W = { app: 0.3, object: 0.3, action: 0.4 };

const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const firstWord = (s: string) => norm(s).split(" ")[0] ?? "";

export const isSelfSurface = (e: Pick<ScreenEvent, "app" | "window">) =>
  [e.app, e.window].some((v) => v !== undefined && SELF_SURFACES.some((re) => re.test(v)));

function appScore(event: ScreenEvent, step: WorkMapStep): number {
  const want = norm(step.screen_moment.app);
  const got = norm(event.app);
  if (!want || !got) return 0;
  return got === want || got.includes(want) || want.includes(got) ? 1 : 0;
}

function objectScore(event: ScreenEvent, step: WorkMapStep): number {
  const entity = norm(step.screen_moment.entity);
  const kind = norm(event.entity.kind);
  if (!entity || !kind) return 0;
  return firstWord(entity) === firstWord(kind) || entity.includes(kind) ? 1 : 0;
}

function actionScore(event: ScreenEvent, step: WorkMapStep): number {
  const want = norm(step.screen_moment.field);
  const got = norm(event.field);
  return want && got && want === got ? 1 : 0;
}

export function matchStep(event: ScreenEvent, workmap: WorkMap): StepMatch | null {
  if (isSelfSurface(event)) return null;
  let best: StepMatch | null = null;
  for (const step of workmap.steps) {
    const a = actionScore(event, step);
    const o = objectScore(event, step);
    // The action (field) or the object must agree; the app alone is not a match.
    if (!a && !o) continue;
    const confidence = W.app * appScore(event, step) + W.object * o + W.action * a;
    if (confidence >= MATCH_MIN && (!best || confidence > best.confidence)) best = { step, confidence };
  }
  return best;
}
