// Browser side of onboarding: save a step through POST /api/auth/onboarding. A failed save never blocks the flow:
// the caller shows the error and moves on (nothing completes, so 'Finish setup' stays in the menu).
import { captureHref } from "@/components/agents/model";
import { parseState, type OnboardingState, type OnboardingStep, type StepMark } from "./state";

export const ONBOARDING_API = "/api/auth/onboarding";
export const SAVE_ERROR = "Your progress could not be saved. You can keep going and finish setup later from the user menu.";

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;
export type SaveResult = { ok: true; state: OnboardingState } | { ok: false; error: string };

export async function saveStep(step: OnboardingStep, mark: StepMark, opts: { agentId?: string | null; fetch?: Fetch } = {}): Promise<SaveResult> {
  const f = opts.fetch ?? ((u, i) => fetch(u, i));
  try {
    const res = await f(ONBOARDING_API, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ step, mark, ...(opts.agentId ? { agentId: opts.agentId } : {}) }),
    });
    if (!res.ok) return { ok: false, error: SAVE_ERROR };
    return { ok: true, state: parseState(((await res.json()) as { state?: OnboardingState }).state) };
  } catch {
    return { ok: false, error: SAVE_ERROR };
  }
}

/** 'Start your first training': marks the walkthrough done, then Capture with the new agent (or plain Capture). */
export async function startFirstTraining(agentId: string | null, opts: { fetch?: Fetch } = {}): Promise<{ href: string; save: SaveResult }> {
  const save = await saveStep("training", "done", { agentId, fetch: opts.fetch });
  return { href: agentId ? captureHref(agentId) : "/capture", save };
}
