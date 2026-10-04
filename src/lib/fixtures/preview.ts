// Populated states for the local preview routes (design compare, docs/design/compare/): Pip learning
// 'Code incoming supplier invoices' from Sabine, with a confirmed Work Map. Local mode only.
import type { DebriefState } from "@/lib/debrief/controller";
import type { Intervention } from "@/lib/teach/intervention";
import type { Guardrail, Session, WorkMap, WorkMapStep } from "@/lib/types";
import { previewSessions } from "./agents";

const g = (rule: string, kind: Guardrail["kind"], quote?: string): Guardrail => ({ rule, quote_ref: 0, kind, ...(quote ? { quote } : {}) });

const s = (n: number, title: string, entity: string, judgment: boolean, guardrails: Guardrail[], score: [number, number]): WorkMapStep => ({
  n,
  title,
  screen_moment: { t: n * 210, app: "ERP", entity },
  decision: title,
  is_judgment_call: judgment,
  reason: null,
  guardrails,
  scores: { reason_captured: score[0], guardrail_captured: score[1] },
});

export const pipWorkMap: WorkMap = {
  task: "Code incoming supplier invoices",
  expert: "Sabine Keller",
  confirmed_by_expert: true,
  open_questions: [],
  steps: [
    s(1, "Open the invoice next to the mail", "Invoice 4471", false, [], [0.9, 0.85]),
    s(2, "Check for a duplicate", "Invoice 4502", true, [g("Search the invoice number before coding", "stop_and_ask", "Alpen billed December twice last year.")], [0.8, 0.82]),
    s(3, "Read the line items", "Invoice 4502", false, [], [0.88, 0.9]),
    s(4, "Code the invoice to a cost center", "Invoice 4517", true, [
      g("Equipment over €5,000 → capex 0400", "limit", "Anything that is a machine goes to capex, the rest is opex 4711."),
      g("Machine or spare part unclear → ask", "stop_and_ask", "If I can't tell, I ask Urs. Every time."),
    ], [0.78, 0.8]),
    s(5, "Send amounts over €5,000 to the controller", "Invoice 4517", false, [g("Over €5,000 goes to the controller first", "limit")], [0.84, 0.86]),
    s(6, "Second approval, Czech subsidiary", "Invoice 4523", true, [g("Czech invoices always get Pavel's second approval", "exception", "Even fifty euros. Brno has its own audit.")], [0.42, 0.55]),
    s(7, "Post in the ERP and file the PDF", "Invoice 4523", false, [], [0.92, 0.9]),
  ],
};

/** previewSessions with pip-1 carrying the full invoice Work Map. */
export const previewSessionsFull: Session[] = previewSessions.map((x) => (x.id === "pip-1" ? { ...x, workmap: pipWorkMap } : x));

export const previewDebriefSession: Session = { ...previewSessionsFull.find((x) => x.id === "pip-1")!, workmap: { ...pipWorkMap, confirmed_by_expert: false } };

const snap = (at: number, bump: number) => ({
  at,
  steps: pipWorkMap.steps.map((st) => ({
    n: st.n,
    reason_captured: Math.min(1, st.scores.reason_captured + bump),
    guardrail_captured: Math.min(1, st.scores.guardrail_captured + bump),
  })),
});

const TEACH_BACK =
  "Here is how I understood it. When an invoice comes in, you open the mail and the PDF side by side and search the invoice number first, because Alpen billed December twice last year. Equipment over €5,000 goes to capex 0400, everything else to opex 4711, and if you can't tell a machine from a spare part, you ask Urs. Invoices for the Czech subsidiary always get Pavel's second approval, at any amount. Then you post in the ERP and file the PDF under the supplier number.";

/** Debrief in progress: ?state=asking (follow-up with a live answer) or ?state=teach_back. */
export function previewDebriefState(state: "asking" | "teach_back"): DebriefState {
  const question = {
    text: "On invoice 4502 you added Pavel as a second approver. Is that for every Czech invoice, or only above an amount?",
    about: "reason" as const,
    step_n: 6,
    source: "gap" as const,
  };
  return {
    phase: state,
    busy: false,
    question: state === "asking" ? question : null,
    queue: [],
    asked: [question],
    followUpsAsked: 1,
    minFollowUps: 3,
    maxFollowUps: 6,
    understood: state === "teach_back",
    endReason: state === "teach_back" ? "all steps above threshold" : null,
    history: state === "asking" ? [snap(0, -0.1), snap(1, 0)] : [snap(0, 0), snap(1, 0.15)],
    workmap: previewDebriefSession.workmap ?? null,
    gaps: [],
    teachBack: state === "teach_back" ? TEACH_BACK : null,
    awaitingCorrection: false,
    error: null,
  };
}

export const previewLiveAnswer = { speaker: "Sabine", text: "Every Czech invoice. Even fifty euros. Brno has its own audit and they check every single one" };

/** Teach live session: step 4 of 7, two guardrails watched, a short transcript and the replay card. */
export const previewTeach = {
  workmap: pipWorkMap,
  currentStep: pipWorkMap.steps[3],
  transcript: [
    { id: "l1", speaker: "tutor" as const, text: "Next one is the Krämer invoice, 4517. Have a look at the amount first." },
    { id: "l2", speaker: "learner" as const, text: "Seven thousand two hundred. A servo drive unit." },
    { id: "l3", speaker: "tutor" as const, text: "Good. Before you code it: is that a machine or a spare part?" },
  ],
  intervention: {
    id: "iv-1",
    key: "4|0",
    step: pipWorkMap.steps[3],
    guardrail: pipWorkMap.steps[3].guardrails[0],
    expert: "Sabine",
    say: "Sabine stops here.",
    quote: "Anything that is a machine goes to capex, the rest is opex 4711.",
    replay: { t: 840, quote: "Anything that is a machine goes to capex, the rest is opex 4711." },
    halo: false,
    notice: null,
    source: "rule",
    probability: 0.9,
  } as Intervention,
  stats: { interventions: 1, active: 1, decideCalls: 6, decideFailures: 0, lastDecideError: null, capped: false },
};
