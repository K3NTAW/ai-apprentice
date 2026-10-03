import { describe, expect, it } from "vitest";
import {
  DECISION_QUESTIONS,
  ScreenEventSchema,
  WorkMapSchema,
  newId,
} from "./types";

// docs/BUILD_SPEC.md section 8, placeholders replaced by one concrete value.
const screenEventExample = {
  id: "ev_031",
  t: 192.4,
  source: "vision",
  type: "field_changed",
  entity: { kind: "invoice", id: "4471" },
  field: "cost_center",
  from: "4711",
  to: "0400",
  frame_ref: "frames/0192.jpg",
};

const workMapExample = {
  task: "Process supplier invoices before month-end close",
  expert: "Sabine",
  confirmed_by_expert: true,
  steps: [
    {
      n: 4,
      title: "Code the invoice to a cost center",
      screen_moment: { t: 192.0, frame_ref: "frames/0192.jpg", entity: "invoice 4471", field: "cost_center" },
      decision: "Re-coded from opex (4711) to capex (0400)",
      is_judgment_call: true,
      reason: { quote: "Equipment over €5,000 is always capex.", t: 195.0, source: "live_question" },
      guardrails: [
        { rule: "No asset number, no capex booking.", quote_ref: 211.5, kind: "limit" },
        { rule: "Unknown supplier: stop and ask the controller.", quote_ref: 640.2, kind: "stop_and_ask" },
      ],
      scores: { reason_captured: 0.93, guardrail_captured: 0.88 },
    },
  ],
  open_questions: [],
};

describe("types", () => {
  it("parses the spec ScreenEvent example", () => {
    expect(ScreenEventSchema.parse(screenEventExample)).toEqual(screenEventExample);
  });

  it("parses the spec WorkMap example", () => {
    expect(WorkMapSchema.parse(workMapExample)).toEqual(workMapExample);
  });

  it("rejects an event with an unknown type", () => {
    const r = ScreenEventSchema.safeParse({ ...screenEventExample, type: "record_deleted" });
    expect(r.success).toBe(false);
  });

  it("rejects a score above 1", () => {
    const step = workMapExample.steps[0];
    const bad = {
      ...workMapExample,
      steps: [{ ...step, scores: { reason_captured: 1.2, guardrail_captured: 0.5 } }],
    };
    expect(WorkMapSchema.safeParse(bad).success).toBe(false);
  });

  it("has exactly the six decision questions with the listed options", () => {
    expect(Object.keys(DECISION_QUESTIONS).sort()).toEqual(
      [
        "ask_timing",
        "event_class",
        "screen_explains_it",
        "step_guardrail_captured",
        "step_reason_captured",
        "violates_guardrail",
      ],
    );
    expect(DECISION_QUESTIONS.event_class.options).toEqual(["routine", "judgment_call", "possible_guardrail"]);
    expect(DECISION_QUESTIONS.ask_timing.options).toEqual(["ask_now", "wait", "save_for_debrief"]);
  });

  it("newId prefixes a short random id", () => {
    expect(newId("ev")).toMatch(/^ev_[a-z0-9]+$/);
  });
});
