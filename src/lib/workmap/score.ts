// Scoring loop and gap list (docs/BUILD_SPEC.md section 6 row 3). Server-side only.
import { decideMany, type DecideOptions } from "@/lib/decide";
import { SCORE_THRESHOLD, type ScreenEvent, type Session, type WorkMap, type WorkMapStep } from "@/lib/types";
import { entityLabel, normalise } from "./synthesize";

const RELATED_WINDOW_S = 60;

export type ScoreOptions = DecideOptions & { decideImpl?: typeof decideMany };

export type Gap = {
  step_n: number;
  missing: "reason" | "guardrail";
  score: number;
  suggested_question: string;
};

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
const asScore = (a: unknown) => clamp01(typeof a === "number" ? a : Number(a));

/** Expert transcript and Q&A near the step's screen moment, plus anything the step already quotes. */
function relatedTranscript(step: WorkMapStep, session: Session) {
  const t = step.screen_moment.t;
  const near = (x: number) => Math.abs(x - t) <= RELATED_WINDOW_S;
  const quoted = new Set([step.reason?.t, ...step.guardrails.map((g) => g.quote_ref)].filter((x) => x !== undefined));
  const out: { t: number; speaker: string; text: string }[] = [];
  for (const e of session.transcript) {
    if (near(e.t) || quoted.has(e.t)) out.push({ t: e.t, speaker: e.speaker, text: e.text });
  }
  for (const q of session.qa) {
    const ta = q.t_answer ?? q.t_question;
    if (!near(q.t_question) && !quoted.has(ta)) continue;
    out.push({ t: q.t_question, speaker: "agent", text: q.question });
    if (q.answer) out.push({ t: ta, speaker: "expert", text: q.answer });
  }
  return out.sort((a, b) => a.t - b.t);
}

export async function scoreWorkMap(workmap: WorkMap, session: Session, opts: ScoreOptions = {}): Promise<WorkMap> {
  const { decideImpl = decideMany, ...decideOpts } = opts;
  const steps = await Promise.all(
    workmap.steps.map(async (step): Promise<WorkMapStep> => {
      const state = { step, related_transcript: relatedTranscript(step, session) };
      const skipGuardrail = !step.is_judgment_call && step.reason !== null;
      const res = skipGuardrail
        ? await decideImpl(["step_reason_captured"], state, decideOpts)
        : await decideImpl(["step_reason_captured", "step_guardrail_captured"], state, decideOpts);
      return {
        ...step,
        scores: {
          reason_captured: asScore(res.step_reason_captured?.answer),
          guardrail_captured: skipGuardrail ? 1 : asScore(res.step_guardrail_captured?.answer),
        },
      };
    }),
  );
  return { ...workmap, steps };
}

// ---------- gap questions ----------

const label = (f: string) => f.replace(/_/g, " ");

function eventFor(step: WorkMapStep, session?: Session): ScreenEvent | undefined {
  if (!session) return undefined;
  const m = step.screen_moment;
  const same = session.events.filter(
    (e) => e.t === m.t && normalise(entityLabel(e.entity)) === normalise(m.entity) && (!m.field || e.field === m.field),
  );
  return same.find((e) => e.type !== "status_changed" && e.type !== "navigated" && e.type !== "app_switched") ?? same[0];
}

type Kind = "hold" | "second_approval" | "save" | "field" | "sent" | "deleted" | "other";

function stepKind(step: WorkMapStep, ev?: ScreenEvent): Kind {
  if (ev?.type === "item_sent") return "sent";
  if (ev?.type === "item_deleted") return "deleted";
  const f = ev?.field ?? step.screen_moment.field;
  if (f === "hold" || f === "second_approval" || f === "save") return f;
  if (f === "approval_status") {
    const to = ev?.to;
    if (to === "on_hold") return "hold";
    if (to === "second_approval") return "second_approval";
    if (to === "saved") return "save";
    return "other";
  }
  if (ev && ev.type !== "field_changed" && ev.type !== "text_entered") return "other";
  return f ? "field" : "other";
}

function changeClause(step: WorkMapStep, ev?: ScreenEvent): string {
  const field = label(step.screen_moment.field ?? "field");
  const range = ev?.from !== undefined && ev?.to !== undefined ? ` from ${ev.from} to ${ev.to}` : "";
  return `You changed the ${field} of ${step.screen_moment.entity}${range}.`;
}

export function suggestedQuestion(step: WorkMapStep, missing: Gap["missing"], session?: Session): string {
  const ev = eventFor(step, session);
  const entity = step.screen_moment.entity || "this record";
  const kind = stepKind(step, ev);
  if (missing === "reason") {
    switch (kind) {
      case "field":
        return `${changeClause(step, ev)} What made you do that?`;
      case "hold":
        return `You held ${entity}. What made you hold it?`;
      case "second_approval":
        return `You sent ${entity} for a second approval. What made you do that?`;
      case "save":
        return `You saved ${entity}. What did you check before saving it?`;
      case "sent":
        return `You sent ${entity}${ev?.to ? ` to ${ev.to}` : ""}. Why that person?`;
      case "deleted":
        return `You deleted ${entity}. What made you delete it?`;
      default:
        return `At ${entity} you decided to ${step.decision.charAt(0).toLowerCase()}${step.decision.slice(1)}. What made you do that?`;
    }
  }
  switch (kind) {
    case "field":
      return `${changeClause(step, ev)} Is there a rule or limit behind that, and when would you stop and ask someone?`;
    case "hold":
      return `You held ${entity}. Is that always the case, and who decides when to release it?`;
    case "second_approval":
      return `You sent ${entity} for a second approval. When is that required, and is there ever an exception?`;
    case "save":
      return `You saved ${entity}. Is there anything that would stop you from saving it?`;
    case "sent":
      return `You sent ${entity} on. When would you not, or stop and ask someone first?`;
    case "deleted":
      return `You deleted ${entity}. Is there anything you would never delete, or a case where you would ask first?`;
    default:
      return `At ${entity}, is there a rule you never break, or a case where you would stop and ask someone?`;
  }
}

/** Steps whose scores are below SCORE_THRESHOLD, lowest score first. */
export function gaps(workmap: WorkMap, session?: Session): Gap[] {
  const out: Gap[] = [];
  for (const step of workmap.steps) {
    const { reason_captured, guardrail_captured } = step.scores;
    if (reason_captured < SCORE_THRESHOLD) {
      out.push({ step_n: step.n, missing: "reason", score: reason_captured, suggested_question: suggestedQuestion(step, "reason", session) });
    }
    if (guardrail_captured < SCORE_THRESHOLD) {
      out.push({
        step_n: step.n,
        missing: "guardrail",
        score: guardrail_captured,
        suggested_question: suggestedQuestion(step, "guardrail", session),
      });
    }
  }
  return out.sort((a, b) => a.score - b.score || a.step_n - b.step_n || (a.missing === "reason" ? -1 : 1));
}

export function isUnderstood(workmap: WorkMap): boolean {
  return workmap.steps.length > 0 && gaps(workmap).length === 0;
}
