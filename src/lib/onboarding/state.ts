// Onboarding state (T-0211), framework free. Four steps; each is done or skipped. onboarding_completed_at is set once
// every step is done or skipped. 'Finish setup' stays in the user menu while onboarding is not complete or a required
// step (workspace, first agent) was skipped. Desktop permissions cannot be granted in a browser (the desktop app
// re-checks them live) and the training walkthrough is information only: skipping either does not keep it open.
// Storage: Supabase user_metadata (onboarding_completed_at, onboarding_steps, onboarding_agent_id) written server side
// with auth.updateUser by POST /api/auth/onboarding; local mode: <DATA_DIR>/onboarding.json (lib/onboarding/file).
// Grandfathering: users created before ONBOARDING_SINCE, or with no created_at, count as completed.
// Kill switch: ONBOARDING_ENABLED=0 (or false/off) turns the sign-in redirect and the menu entry off. Default on.

export const ONBOARDING_STEPS = ["workspace", "permissions", "agent", "training"] as const;
export type OnboardingStep = (typeof ONBOARDING_STEPS)[number];
export type StepMark = "done" | "skipped";
export type OnboardingState = {
  completedAt: string | null;
  steps: Partial<Record<OnboardingStep, StepMark>>;
  /** The agent made in the agent step; reused on resume so no second agent is created. */
  agentId: string | null;
};

export const STEP_LABELS: Record<OnboardingStep, string> = {
  workspace: "Workspace",
  permissions: "Desktop permissions",
  agent: "First agent",
  training: "How training works",
};

export const META_KEYS = { completedAt: "onboarding_completed_at", steps: "onboarding_steps", agentId: "onboarding_agent_id" } as const;
export const ONBOARDING_SINCE = "2026-10-04T00:00:00Z";
export const ONBOARDING_PATH = "/onboarding";
const ID_MAX = 64;

export const isStep = (v: unknown): v is OnboardingStep => typeof v === "string" && (ONBOARDING_STEPS as readonly string[]).includes(v);
export const isMark = (v: unknown): v is StepMark => v === "done" || v === "skipped";

export function onboardingEnabled(value: string | undefined = process.env.ONBOARDING_ENABLED): boolean {
  return !value || !/^(0|false|off|no)$/i.test(value.trim());
}

export const emptyState = (): OnboardingState => ({ completedAt: null, steps: {}, agentId: null });

/** Validates a stored value (metadata or the local file). Unknown keys and bad values are dropped. */
export function parseState(raw: { completedAt?: unknown; steps?: unknown; agentId?: unknown } | null | undefined): OnboardingState {
  const steps: OnboardingState["steps"] = {};
  if (raw?.steps && typeof raw.steps === "object") {
    for (const [k, v] of Object.entries(raw.steps as Record<string, unknown>)) if (isStep(k) && isMark(v)) steps[k] = v;
  }
  const completedAt = typeof raw?.completedAt === "string" && raw.completedAt ? raw.completedAt : null;
  const agentId = typeof raw?.agentId === "string" && raw.agentId && raw.agentId.length <= ID_MAX ? raw.agentId : null;
  return { completedAt, steps, agentId };
}

type MetaUser = { created_at?: string | null; user_metadata?: Record<string, unknown> | null };

/** From Supabase user_metadata. Users from before onboarding existed (or of unknown age) count as completed. */
export function stateFromUser(user: MetaUser): OnboardingState {
  const meta = user.user_metadata ?? {};
  const state = parseState({ completedAt: meta[META_KEYS.completedAt], steps: meta[META_KEYS.steps], agentId: meta[META_KEYS.agentId] });
  const untouched = !state.completedAt && Object.keys(state.steps).length === 0;
  if (untouched && (!user.created_at || user.created_at < ONBOARDING_SINCE)) return { ...state, completedAt: ONBOARDING_SINCE };
  return state;
}

export function toMetadata(s: OnboardingState): Record<string, unknown> {
  return { [META_KEYS.completedAt]: s.completedAt, [META_KEYS.steps]: s.steps, [META_KEYS.agentId]: s.agentId };
}

export const isComplete = (s: OnboardingState) => Boolean(s.completedAt);

/** Steps whose skip keeps 'Finish setup' in the user menu. */
export const REQUIRED_STEPS: readonly OnboardingStep[] = ["workspace", "agent"];

const anySkipped = (s: OnboardingState, steps: readonly OnboardingStep[] = ONBOARDING_STEPS) => steps.some((k) => s.steps[k] === "skipped");

/** The user menu shows 'Finish setup' while onboarding is not complete or a required step was skipped. */
export const finishSetupVisible = (s: OnboardingState) => !isComplete(s) || anySkipped(s, REQUIRED_STEPS);

/** A done step stays done; completedAt is set once every step is marked and never cleared. */
export function markStep(s: OnboardingState, step: OnboardingStep, mark: StepMark, now: string, agentId?: string | null): OnboardingState {
  const steps = { ...s.steps, [step]: s.steps[step] === "done" ? "done" : mark };
  const all = ONBOARDING_STEPS.every((k) => isMark(steps[k]));
  return { completedAt: s.completedAt ?? (all ? now : null), steps, agentId: agentId ?? s.agentId };
}

/** Where to resume: the first step never marked, else the first skipped required one, else any skipped, else the walkthrough. */
export function resumeStep(s: OnboardingState): OnboardingStep {
  const skipped = (k: OnboardingStep) => s.steps[k] === "skipped";
  return ONBOARDING_STEPS.find((k) => !s.steps[k]) ?? REQUIRED_STEPS.find(skipped) ?? ONBOARDING_STEPS.find(skipped) ?? "training";
}

export const onboardingHref = (next?: string | null) =>
  next && next !== "/" ? `${ONBOARDING_PATH}?next=${encodeURIComponent(next)}` : ONBOARDING_PATH;

/** Where a finished user goes instead of /onboarding: the next path, or /agents when that is onboarding itself. */
const leaveOnboarding = (next: string) => (next.startsWith(ONBOARDING_PATH) ? "/agents" : next);

/** After sign-in (magic-link callback, password bootstrap): /onboarding while not completed, else the safe next. */
export function afterSignIn(user: MetaUser | null | undefined, next: string, enabled = onboardingEnabled()): string {
  if (!enabled || !user) return next;
  if (isComplete(stateFromUser(user))) return leaveOnboarding(next);
  return next.startsWith(ONBOARDING_PATH) ? next : onboardingHref(next);
}

/** 'Finish setup' in the user menu opens /onboarding with this flag; without it a finished user never sees the flow. */
export const RESUME_PARAM = "resume";
export const finishSetupHref = `${ONBOARDING_PATH}?${RESUME_PARAM}=1`;

/**
 * /onboarding for a user whose stored (server side) state is complete (T-0255): where to send them instead, or null
 * to show the flow. Only an explicit resume ('Finish setup', or a ?step= link) with a step still skipped (required or
 * not) shows it again.
 */
export function finishedRedirect(s: OnboardingState, next: string, explicit: boolean): string | null {
  if (!isComplete(s)) return null;
  if (explicit && anySkipped(s)) return null;
  return leaveOnboarding(next);
}
