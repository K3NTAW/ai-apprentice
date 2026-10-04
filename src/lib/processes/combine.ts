// Processes slice (c): 'Add to it' merges a newly confirmed Work Map into a process's current one. Pure, no I/O.
// Steps match by app, object (screen entity) and action (title). A matched step keeps everything it had: its reason
// stays, new guardrails are added with their own quotes and quote_ref, a different new reason or decision becomes an
// open question (a conflict for the expert). Unmatched new steps are inserted after the step they followed in the new
// map. Steps are renumbered; nothing old is dropped. changes is the short teach-back of what changed.
import type { Guardrail, WorkMap, WorkMapShortcut, WorkMapStep } from "@/lib/types";

export type MergeOutcome = { workmap: WorkMap; changes: string[]; conflicts: string[] };

const norm = (s: string | undefined) => (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const stepKey = (s: WorkMapStep) => `${norm(s.screen_moment.app)}|${norm(s.screen_moment.entity)}|${norm(s.title)}`;
const ruleKey = (g: Guardrail) => norm(g.rule);
const shortcutKey = (s: WorkMapShortcut) => `${norm(s.chord)}|${norm(s.app)}`;

function mergeStep(old: WorkMapStep, add: WorkMapStep, changes: string[], conflicts: string[]): WorkMapStep {
  const label = `Step "${old.title}"`;
  let reason = old.reason;
  if (!old.reason && add.reason) {
    reason = add.reason;
    changes.push(`${label}: reason added ("${add.reason.quote}").`);
  } else if (old.reason && add.reason && norm(old.reason.quote) !== norm(add.reason.quote)) {
    conflicts.push(`${label}: the reason was "${old.reason.quote}", the new session says "${add.reason.quote}". Which one holds?`);
  }
  if (norm(old.decision) !== norm(add.decision) && norm(add.decision))
    conflicts.push(`${label}: the decision was "${old.decision}", the new session says "${add.decision}". Which one holds?`);
  const known = new Set(old.guardrails.map(ruleKey));
  const added = add.guardrails.filter((g) => !known.has(ruleKey(g)));
  for (const g of added) changes.push(`${label}: guardrail added ("${g.rule}").`);
  return {
    ...old,
    reason,
    is_judgment_call: old.is_judgment_call || add.is_judgment_call,
    guardrails: [...old.guardrails, ...added],
    scores: {
      reason_captured: Math.max(old.scores.reason_captured, reason === old.reason ? old.scores.reason_captured : add.scores.reason_captured),
      guardrail_captured: Math.max(old.scores.guardrail_captured, add.scores.guardrail_captured),
    },
  };
}

/** Merges `next` into `current`; the result keeps current's task and is confirmed when both are. */
export function mergeWorkMaps(current: WorkMap, next: WorkMap): MergeOutcome {
  const changes: string[] = [];
  const conflicts: string[] = [];
  const steps = current.steps.map((s) => ({ ...s }));
  const index = new Map(steps.map((s, i) => [stepKey(s), i]));
  // Where the previous step of the new map sits in the merged list; new steps go right after it.
  let after = -1;
  for (const add of next.steps) {
    const at = index.get(stepKey(add));
    if (at !== undefined) {
      steps[at] = mergeStep(steps[at]!, add, changes, conflicts);
      after = at;
      continue;
    }
    const pos = after + 1;
    steps.splice(pos, 0, { ...add });
    for (const [k, i] of index) if (i >= pos) index.set(k, i + 1);
    index.set(stepKey(add), pos);
    after = pos;
    changes.push(`New step "${add.title}" added as step ${pos + 1}.`);
  }
  const shortcuts = [...(current.shortcuts ?? [])];
  const knownShortcuts = new Set(shortcuts.map(shortcutKey));
  for (const s of next.shortcuts ?? []) {
    if (knownShortcuts.has(shortcutKey(s))) continue;
    knownShortcuts.add(shortcutKey(s));
    shortcuts.push(s);
    changes.push(`Shortcut ${s.chord} in ${s.app} added.`);
  }
  const questions = [...current.open_questions];
  for (const q of [...next.open_questions, ...conflicts]) if (!questions.includes(q)) questions.push(q);
  if (changes.length === 0 && conflicts.length === 0) changes.push("Nothing new: the process already covers this session.");
  return {
    workmap: {
      ...current,
      confirmed_by_expert: current.confirmed_by_expert && next.confirmed_by_expert,
      steps: steps.map((s, i) => ({ ...s, n: i + 1 })),
      open_questions: questions,
      ...(shortcuts.length > 0 || current.shortcuts ? { shortcuts } : {}),
    },
    changes,
    conflicts,
  };
}
