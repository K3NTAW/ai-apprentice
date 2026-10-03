// Teach save-hook check (docs/BUILD_SPEC.md Module 3, NEVER CUT: save-hook interception).
// Deterministic rules from the Work Map run first and need no network. Then one injected decide call
// with a timeout; a decide error or timeout never blocks and never throws.
import type { Guardrail, Invoice, WorkMap, WorkMapStep } from "@/lib/types";

export type PendingAction = "save" | "hold" | "second_approval";

export type DecideFn = (
  question: "violates_guardrail",
  state: { pending: Invoice; action: PendingAction; guardrails: Guardrail[] },
) => Promise<{ answer: string | number } | number>;

export type CheckResult = {
  allow: boolean;
  step?: WorkMapStep;
  guardrail?: Guardrail;
  field?: string;
  explanation?: string;
  probability: number;
};

export const DECIDE_TIMEOUT_MS = 2500;
export const BLOCK_PROBABILITY = 0.6;

const EQUIPMENT = /\b(equipment|machine|machinery|press|servo|drive unit|device)\b/i;

type RuleKind = "capex" | "asset" | "second_approval";

const RULE_FIELD: Record<RuleKind, string> = {
  capex: "cost_center",
  asset: "asset_number",
  second_approval: "second_approval",
};
const RULE_WORDS: Record<RuleKind, RegExp> = {
  capex: /capex|equipment|cost cent/i,
  asset: /asset/i,
  second_approval: /second approval|subsidiary|czech/i,
};

export function isEquipmentLike(inv: Pick<Invoice, "description" | "amount_eur">): boolean {
  return EQUIPMENT.test(inv.description) || inv.amount_eur > 5000;
}

export function isSubsidiary(inv: Pick<Invoice, "supplier_entity" | "supplier_country">): boolean {
  return /subsidiary|intercompany/i.test(inv.supplier_entity) || inv.supplier_country.toUpperCase() === "CZ";
}

function guardrailText(g: Guardrail): string {
  return `${g.rule} ${g.quote ?? ""}`;
}

/** The step (and guardrail) the map ties to a rule: the step on that screen field first, then by guardrail wording. */
export function findRuleStep(workmap: WorkMap, kind: RuleKind): { step: WorkMapStep; guardrail?: Guardrail } | null {
  const matches = (g: Guardrail) => {
    const t = guardrailText(g);
    return RULE_WORDS[kind].test(t) && !(kind === "capex" && /asset/i.test(t));
  };
  const byField = workmap.steps.find((s) => s.screen_moment.field === RULE_FIELD[kind]);
  if (byField) return { step: byField, guardrail: byField.guardrails.find(matches) ?? byField.guardrails[0] };
  for (const step of workmap.steps) {
    const g = step.guardrails.find(matches);
    if (g) return { step, guardrail: g };
  }
  return null;
}

export function expertQuote(step: WorkMapStep, guardrail?: Guardrail): string {
  return guardrail?.quote ?? step.reason?.quote ?? guardrail?.rule ?? step.decision;
}

/** 'Sabine would stop here. "Equipment over €5,000 is always capex."' */
export function stopExplanation(expert: string, step: WorkMapStep, guardrail?: Guardrail): string {
  return `${expert} would stop here. "${expertQuote(step, guardrail)}"`;
}

/** Pure: the first map rule the draft breaks for this action, or null. */
export function ruleViolation(action: PendingAction, draft: Invoice, workmap: WorkMap): CheckResult | null {
  const hit = (kind: RuleKind): CheckResult | null => {
    const found = findRuleStep(workmap, kind);
    if (!found) return null;
    return {
      allow: false,
      step: found.step,
      guardrail: found.guardrail,
      field: RULE_FIELD[kind],
      explanation: stopExplanation(workmap.expert, found.step, found.guardrail),
      probability: 1,
    };
  };
  if (action === "hold") return null;
  const checks: [boolean, RuleKind][] = [
    [action === "save" && isEquipmentLike(draft) && draft.cost_center !== "0400", "capex"],
    [draft.cost_center === "0400" && !draft.asset_number.trim(), "asset"],
    [action === "save" && isSubsidiary(draft), "second_approval"],
  ];
  for (const [broken, kind] of checks) {
    const r = broken ? hit(kind) : null;
    if (r) return r;
  }
  return null;
}

function tokens(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z0-9€]{3,}/g) ?? []);
}

/** The guarded step whose wording best matches the draft; the first guarded step on a tie. */
export function bestKeywordStep(workmap: WorkMap, draft: Invoice): WorkMapStep | undefined {
  const want = tokens(`${draft.description} ${draft.supplier} ${draft.supplier_entity} ${draft.cost_center}`);
  let best: WorkMapStep | undefined;
  let bestScore = -1;
  for (const step of workmap.steps.filter((s) => s.guardrails.length > 0)) {
    const have = tokens(`${step.title} ${step.decision} ${step.guardrails.map(guardrailText).join(" ")}`);
    let score = 0;
    for (const t of want) if (have.has(t)) score++;
    if (score > bestScore) {
      best = step;
      bestScore = score;
    }
  }
  return best;
}

/** The step a learner should predict when this invoice opens. */
export function predictionStepFor(workmap: WorkMap, inv: Invoice): WorkMapStep | undefined {
  const kind: RuleKind | null = isSubsidiary(inv) ? "second_approval" : isEquipmentLike(inv) ? "capex" : null;
  const found = kind ? findRuleStep(workmap, kind) : null;
  return found?.step ?? workmap.steps.find((s) => s.is_judgment_call) ?? workmap.steps[0];
}

function toProbability(r: { answer: string | number } | number): number {
  const v = typeof r === "number" ? r : typeof r.answer === "number" ? r.answer : Number.parseFloat(r.answer);
  return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0;
}

export async function checkPendingAction(input: {
  action: PendingAction;
  draft: Invoice;
  workmap: WorkMap;
  decide: DecideFn;
  timeoutMs?: number;
}): Promise<CheckResult> {
  const { action, draft, workmap, decide } = input;
  const rule = ruleViolation(action, draft, workmap);
  if (rule) return rule;

  const guardrails = workmap.steps.flatMap((s) => s.guardrails);
  let probability: number;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("decide timeout")), input.timeoutMs ?? DECIDE_TIMEOUT_MS);
    });
    const asked = Promise.resolve().then(() => decide("violates_guardrail", { pending: draft, action, guardrails }));
    asked.catch(() => {}); // a late rejection after the timeout must not surface as unhandled
    probability = toProbability(await Promise.race([asked, timeout]));
  } catch {
    return { allow: true, probability: 0 };
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (probability < BLOCK_PROBABILITY) return { allow: true, probability };

  const step = bestKeywordStep(workmap, draft);
  if (!step) return { allow: true, probability };
  const guardrail = step.guardrails[0];
  return {
    allow: false,
    step,
    guardrail,
    field: step.screen_moment.field,
    explanation: stopExplanation(workmap.expert, step, guardrail),
    probability,
  };
}

/** Client-side decide over POST /api/decide. */
export const decideViaApi: DecideFn = async (question, state) => {
  const res = await fetch("/api/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, state }),
  });
  if (!res.ok) throw new Error(`decide ${res.status}`);
  const body = (await res.json()) as { results?: Record<string, { answer: string | number }> };
  const r = body.results?.[question];
  if (!r) throw new Error("decide: no result");
  return r;
};
