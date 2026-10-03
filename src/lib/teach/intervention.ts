// Teach intervention on real apps (replaces the sandbox save-hook check). Framework free; I/O is injected.
// For every value-changing screen event matched to a Work Map step:
//   1. deterministic limit rules parsed from the step's guardrails run first (no network);
//   2. else one decide('violates_guardrail') call, capped (dedupe, per-field gap, per-minute max, usage cap);
//   3. a hit makes the tutor stop by voice, show the expert's quote and moment, and draw the companion halo.
// A decide error or timeout never intervenes; it is counted and shown.
import { SCREEN_EVENT_TYPES, type Guardrail, type Rect, type ScreenEvent, type WorkMap, type WorkMapStep } from "@/lib/types";
import type { StepMatch } from "./stepMatch";

/** Event types that change a value or state; the event also needs a field and a `to` that differs from `from`. */
export const VALUE_CHANGE_TYPES = ["field_changed", "status_changed", "text_entered"] as const satisfies readonly (typeof SCREEN_EVENT_TYPES)[number][];

export const DECIDE_TIMEOUT_MS = 2500;
export const INTERVENE_PROBABILITY = 0.6;
export const DECIDE_MAX_PER_MINUTE = 6;
/** Minimum gap between two decide calls for the same step and field (debounce of fast edits). */
export const DECIDE_FIELD_GAP_MS = 1000;
/** After an intervention resolves, the same (step, field, value) does not trigger again for this long. */
export const COOLDOWN_MS = 30_000;
export const NOT_PAIRED_NOTICE = "Companion not paired: the tutor stops by voice only, no halo over the app.";

export type PendingChange = {
  step_n: number;
  app?: string;
  entity: string;
  field: string;
  from?: string;
  to: string;
  amount?: number;
};

export type TeachDecide = (
  question: "violates_guardrail",
  state: { pending: PendingChange; guardrails: Guardrail[] },
) => Promise<number>;

export type HaloSink = { showHalo(id: string, rect: Rect, text?: string): boolean; clearHalo(id?: string): boolean };

export type Intervention = {
  id: string;
  key: string;
  step: WorkMapStep;
  guardrail: Guardrail;
  expert: string;
  /** What the tutor says first. */
  say: string;
  quote: string;
  replay: { t: number; frame_ref?: string; quote: string };
  rect?: Rect;
  halo: boolean;
  notice: string | null;
  source: "rule" | "decide";
  probability: number;
  pending: PendingChange;
};

export type ClearReason = "resolved" | "moved_on" | "end" | "pause" | "disconnect" | "unmount";

export type InterventionStats = {
  interventions: number;
  active: number;
  decideCalls: number;
  decideFailures: number;
  lastDecideError: string | null;
  capped: boolean;
};

export type InterventionOptions = {
  workmap: WorkMap;
  decide: TeachDecide;
  companion: HaloSink;
  onIntervene(iv: Intervention): void;
  onClear?(id: string, reason: ClearReason): void;
  onChange?(stats: InterventionStats): void;
  now?: () => number;
  timeoutMs?: number;
  threshold?: number;
};

/** Deterministic rule parsed from guardrail text: "over 5,000 EUR ... coded 0400", "Discount over 10% ...". */
export type LimitRule = { limit: number; unit: "money" | "percent"; required?: string };

const AMOUNT_FIELD = /amount|total|price|sum|value/i;

/** First number in the text: "EUR 7,200" -> 7200, "7'200.50" -> 7200.5, "15%" -> 15. Null when there is none. */
export function parseAmount(text: string | undefined): number | null {
  const m = (text ?? "").match(/\d[\d'’,.\s]*\d|\d/);
  if (!m) return null;
  let s = m[0].replace(/['’\s]/g, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    s = s.split(dec === "." ? "," : ".").join("").replace(",", ".");
  } else if (lastComma >= 0 || lastDot >= 0) {
    const sep = lastComma >= 0 ? "," : ".";
    const parts = s.split(sep);
    // "7,200" / "1.000.000" are thousands; "7,5" / "12.50" are decimals.
    s = parts.length > 2 || parts[parts.length - 1].length === 3 ? parts.join("") : parts.join(".");
  }
  const v = Number(s);
  return Number.isFinite(v) ? v : null;
}

export function limitRule(g: Guardrail): LimitRule | null {
  if (g.kind !== "limit") return null;
  const text = `${g.rule} ${g.quote ?? ""}`;
  const m = text.match(/(?:over|above|more than|exceeds?|>)\s*(?:EUR|CHF|USD|€|\$)?\s*(\d[\d'’,.]*)\s*(%)?/i);
  if (!m) return null;
  const limit = parseAmount(m[1]);
  if (limit === null) return null;
  const req = g.rule.match(/\b(?:coded|code|cost cent(?:er|re)|account)\s+([A-Z0-9][A-Z0-9-]{2,})\b/i);
  return { limit, unit: m[2] ? "percent" : "money", required: req?.[1] };
}

export function isValueChange(e: ScreenEvent): e is ScreenEvent & { field: string; to: string } {
  return (VALUE_CHANGE_TYPES as readonly string[]).includes(e.type) && !!e.field && e.to !== undefined && e.to !== e.from;
}

const norm = (s: string) => s.trim().toLowerCase();

/** Pure: the guardrail this change breaks by a deterministic rule, or null (also when the amount cannot be parsed). */
export function ruleViolation(step: WorkMapStep, change: { field: string; to: string }, caseAmount: number | null): Guardrail | null {
  for (const g of step.guardrails) {
    const rule = limitRule(g);
    if (!rule) continue;
    if (rule.required) {
      if (caseAmount === null || caseAmount <= rule.limit) continue;
      if (norm(change.to) !== norm(rule.required)) return g;
      continue;
    }
    if (rule.unit === "percent" && !change.to.includes("%")) continue;
    const v = parseAmount(change.to);
    if (v !== null && v > rule.limit) return g;
  }
  return null;
}

export function stopLine(expert: string): string {
  return `${expert} would stop here. Why do you think?`;
}

export function createInterventionEngine(opts: InterventionOptions) {
  const now = opts.now ?? Date.now;
  const threshold = opts.threshold ?? INTERVENE_PROBABILITY;
  const timeoutMs = opts.timeoutMs ?? DECIDE_TIMEOUT_MS;
  const active = new Map<string, Intervention & { entity: string; field: string; to: string }>();
  const clearedAt = new Map<string, number>();
  const decided = new Map<string, number>();
  const fieldDecidedAt = new Map<string, number>();
  const current = new Map<string, string>();
  const calls: number[] = [];
  let caseAmount: number | null = null;
  let seq = 0;
  const stats: InterventionStats = { interventions: 0, active: 0, decideCalls: 0, decideFailures: 0, lastDecideError: null, capped: false };

  const changed = () => {
    stats.active = active.size;
    opts.onChange?.({ ...stats });
  };

  function clear(id: string, reason: ClearReason) {
    const iv = active.get(id);
    if (!iv) return;
    active.delete(id);
    clearedAt.set(iv.key, now());
    opts.companion.clearHalo(id);
    opts.onClear?.(id, reason);
  }

  function clearAll(reason: ClearReason) {
    for (const id of [...active.keys()]) clear(id, reason);
    changed();
  }

  async function askDecide(key: string, fieldKey: string, pending: PendingChange, guardrails: Guardrail[]): Promise<number | null> {
    if (decided.has(key)) return decided.get(key)!;
    if (stats.capped) return null;
    const t = now();
    while (calls.length && t - calls[0] >= 60_000) calls.shift();
    if (calls.length >= DECIDE_MAX_PER_MINUTE) return null;
    const last = fieldDecidedAt.get(fieldKey);
    if (last !== undefined && t - last < DECIDE_FIELD_GAP_MS) return null;
    calls.push(t);
    fieldDecidedAt.set(fieldKey, t);
    stats.decideCalls++;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("decide timeout")), timeoutMs);
      });
      const asked = Promise.resolve().then(() => opts.decide("violates_guardrail", { pending, guardrails }));
      asked.catch(() => {}); // a late rejection after the timeout must not surface as unhandled
      const raw = await Promise.race([asked, timeout]);
      const p = Number.isFinite(raw) ? Math.min(1, Math.max(0, raw)) : 0;
      decided.set(key, p);
      return p;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      stats.decideFailures++;
      stats.lastDecideError = msg;
      if (/\b429\b|usage|limit/i.test(msg)) stats.capped = true;
      return null;
    } finally {
      if (timer) clearTimeout(timer);
      changed();
    }
  }

  function intervene(step: WorkMapStep, guardrail: Guardrail, event: ScreenEvent & { field: string; to: string }, key: string, pending: PendingChange, source: Intervention["source"], probability: number) {
    const id = `iv_${++seq}`;
    const expert = opts.workmap.expert || "The expert";
    const quote = guardrail.quote ?? step.reason?.quote ?? guardrail.rule;
    const halo = event.rect ? opts.companion.showHalo(id, event.rect, `${expert} would stop here: ${quote}`) : false;
    const iv: Intervention = {
      id,
      key,
      step,
      guardrail,
      expert,
      say: stopLine(expert),
      quote,
      replay: { t: step.screen_moment.t, frame_ref: step.screen_moment.frame_ref, quote },
      rect: event.rect,
      halo,
      notice: halo ? null : event.rect ? NOT_PAIRED_NOTICE : "No screen position for this change: the tutor stops by voice only.",
      source,
      probability,
      pending,
    };
    active.set(id, { ...iv, entity: event.entity.id, field: event.field, to: event.to });
    stats.interventions++;
    opts.onIntervene(iv);
    changed();
    return iv;
  }

  /** Feed one screen event with its step match (null when it matched no step). */
  async function onEvent(event: ScreenEvent, match: StepMatch | null): Promise<Intervention | null> {
    if (event.field && AMOUNT_FIELD.test(event.field) && event.to !== undefined) {
      const a = parseAmount(event.to);
      if (a !== null) caseAmount = a;
    }
    for (const [id, iv] of active) {
      const sameField = iv.entity === event.entity.id && iv.field === event.field;
      if (sameField && event.to !== undefined && event.to !== iv.to) clear(id, "resolved");
      else if (!sameField && match && match.step.n !== iv.step.n) clear(id, "moved_on");
    }
    changed();
    if (!match || !isValueChange(event)) return null;
    const step = match.step;
    const fieldKey = `${step.n}|${event.entity.id}|${event.field}`;
    current.set(fieldKey, event.to);
    if (step.guardrails.length === 0) return null;
    const key = `${step.n}|${event.field}|${norm(event.to)}`;
    if ([...active.values()].some((iv) => iv.key === key)) return null;
    const cleared = clearedAt.get(key);
    if (cleared !== undefined && now() - cleared < COOLDOWN_MS) return null;

    const pending: PendingChange = {
      step_n: step.n,
      app: event.app,
      entity: `${event.entity.kind} ${event.entity.id}`,
      field: event.field,
      from: event.from,
      to: event.to,
      ...(caseAmount !== null ? { amount: caseAmount } : {}),
    };
    const hit = ruleViolation(step, event, caseAmount);
    if (hit) return intervene(step, hit, event, key, pending, "rule", 1);

    const p = await askDecide(key, fieldKey, pending, step.guardrails);
    // The learner may have changed the value while decide ran: only the latest value counts.
    if (p === null || p < threshold || current.get(fieldKey) !== event.to) return null;
    if ([...active.values()].some((iv) => iv.key === key)) return null;
    const guardrail = step.guardrails.find((g) => g.kind === "limit") ?? step.guardrails[0];
    return intervene(step, guardrail, event, key, pending, "decide", p);
  }

  return {
    onEvent,
    clearAll,
    active: (): Intervention[] => [...active.values()],
    stats: (): InterventionStats => ({ ...stats, active: active.size }),
  };
}

export type InterventionEngine = ReturnType<typeof createInterventionEngine>;

/** Client-side decide over POST /api/decide; returns the violation probability. */
export const decideViaApi: TeachDecide = async (question, state) => {
  const res = await fetch("/api/decide", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ question, state }),
  });
  if (!res.ok) throw new Error(`decide ${res.status}`);
  const body = (await res.json()) as { results?: Record<string, { answer: string | number }> };
  const r = body.results?.[question];
  if (!r) throw new Error("decide: no result");
  const v = typeof r.answer === "number" ? r.answer : Number.parseFloat(r.answer);
  if (!Number.isFinite(v)) throw new Error("decide: not a probability");
  return v;
};
