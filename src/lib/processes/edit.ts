// Slice (d): pure Work Map edits for the process page. Every edit returns a new Work Map; the caller PATCHes it
// (change_kind 'edited'), so the previous Work Map, original quotes included, stays in process_versions.
// An edited quote is marked edited_by <name>. Deleting or reordering steps renumbers them 1..n and moves the
// shortcuts' step with them (a shortcut of a deleted step loses its step).
import type { Role } from "@/lib/auth/context";
import type { Guardrail, WorkMap, WorkMapShortcut, WorkMapStep } from "@/lib/types";

export type StepPatch = { title?: string; decision?: string; reason?: string };
export type GuardrailInput = { rule: string; kind: Guardrail["kind"]; quote?: string };
export type GuardrailPatch = Partial<GuardrailInput>;

export class StepNotFoundError extends Error {
  constructor(n: number) {
    super(`step ${n} not found`);
    this.name = "StepNotFoundError";
  }
}

const clean = (s: string) => s.trim().replace(/\s+/g, " ");

function indexOf(wm: WorkMap, n: number): number {
  const i = wm.steps.findIndex((s) => s.n === n);
  if (i < 0) throw new StepNotFoundError(n);
  return i;
}

function withStep(wm: WorkMap, n: number, fn: (s: WorkMapStep) => WorkMapStep): WorkMap {
  const i = indexOf(wm, n);
  return { ...wm, steps: wm.steps.map((s, k) => (k === i ? fn(s) : s)) };
}

function renumber(wm: WorkMap, order: WorkMapStep[]): WorkMap {
  const to = new Map(order.map((s, i) => [s.n, i + 1]));
  const moveShortcut = (sc: WorkMapShortcut): WorkMapShortcut => {
    if (sc.step === undefined) return sc;
    const n = to.get(sc.step);
    if (n !== undefined) return { ...sc, step: n };
    const rest = { ...sc };
    delete rest.step;
    return rest;
  };
  return {
    ...wm,
    steps: order.map((s, i) => ({ ...s, n: i + 1 })),
    ...(wm.shortcuts ? { shortcuts: wm.shortcuts.map(moveShortcut) } : {}),
  };
}

/** Title, decision and reason text of one step. Blank values change nothing; a changed reason quote is marked. */
export function editStep(wm: WorkMap, n: number, patch: StepPatch, editor: string): WorkMap {
  return withStep(wm, n, (s) => {
    const title = patch.title === undefined ? "" : clean(patch.title);
    const decision = patch.decision === undefined ? "" : patch.decision.trim();
    const quote = patch.reason === undefined ? "" : patch.reason.trim();
    let reason = s.reason;
    if (quote && quote !== s.reason?.quote)
      reason = s.reason
        ? { ...s.reason, quote, edited_by: editor }
        : { quote, t: s.screen_moment.t, source: "debrief", edited_by: editor };
    return { ...s, title: title || s.title, decision: decision || s.decision, reason };
  });
}

export function deleteStep(wm: WorkMap, n: number): WorkMap {
  const i = indexOf(wm, n);
  return renumber(wm, wm.steps.filter((_, k) => k !== i));
}

/** Moves step n by delta places (-1 up, 1 down); at the ends nothing changes. */
export function moveStep(wm: WorkMap, n: number, delta: number): WorkMap {
  const i = indexOf(wm, n);
  const j = i + delta;
  if (j < 0 || j >= wm.steps.length) return wm;
  const order = [...wm.steps];
  [order[i], order[j]] = [order[j], order[i]];
  return renumber(wm, order);
}

export function addGuardrail(wm: WorkMap, n: number, input: GuardrailInput, editor: string): WorkMap {
  const rule = clean(input.rule);
  if (!rule) return wm;
  const quote = input.quote?.trim();
  return withStep(wm, n, (s) => {
    const g: Guardrail = { rule, kind: input.kind, quote_ref: s.reason?.t ?? s.screen_moment.t };
    return { ...s, guardrails: [...s.guardrails, quote ? { ...g, quote, edited_by: editor } : g] };
  });
}

/** Rule and kind are replaced when given; a changed quote is marked edited_by. */
export function editGuardrail(wm: WorkMap, n: number, index: number, patch: GuardrailPatch, editor: string): WorkMap {
  return withStep(wm, n, (s) => ({
    ...s,
    guardrails: s.guardrails.map((g, k) => {
      if (k !== index) return g;
      const rule = patch.rule === undefined ? "" : clean(patch.rule);
      const quote = patch.quote?.trim();
      const next: Guardrail = { ...g, rule: rule || g.rule, kind: patch.kind ?? g.kind };
      return quote && quote !== g.quote ? { ...next, quote, edited_by: editor } : next;
    }),
  }));
}

export function deleteGuardrail(wm: WorkMap, n: number, index: number): WorkMap {
  return withStep(wm, n, (s) => ({ ...s, guardrails: s.guardrails.filter((_, k) => k !== index) }));
}

// Same rules as the API: owner or expert edit; archive and delete are owner actions.
export const canEditProcess = (role: Role | null) => role === "owner" || role === "expert";
export const canArchiveProcess = (role: Role | null) => role === "owner";
export const canDeleteProcess = (role: Role | null) => role === "owner";

export const DELETE_PROCESS_CONFIRM = "Delete this process and its version history? Its capture sessions stay.";
export const ARCHIVE_PROCESS_CONFIRM = "Archive this process? Learners no longer see it; you can restore it from its page.";
export const DELETE_STEP_CONFIRM = "Delete this step? The previous version stays in the history.";
export const RESTORE_VERSION_CONFIRM = "Restore this version? It becomes a new version; nothing is lost.";
