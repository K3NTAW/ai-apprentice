import { describe, expect, it } from "vitest";
import {
  DECISION_QUESTIONS,
  ScreenEventSchema,
  SessionSchema,
  TEACH_LIST_MAX,
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

  it("parses an app-agnostic event with app, window, rect and each new type", () => {
    const ev = {
      id: "ev_1",
      t: 3,
      source: "vision",
      type: "item_sent",
      entity: { kind: "email", id: "Offer Q3" },
      app: "Microsoft Outlook",
      window: "Offer Q3 - Message",
      rect: { x: 0.1, y: 0.2, w: 0.3, h: 0.05 },
      field: "forward",
      to: "controller@example.com",
    };
    expect(ScreenEventSchema.parse(ev)).toEqual(ev);
    for (const type of ["app_switched", "text_entered", "item_created", "item_sent", "item_deleted", "navigated"]) {
      expect(ScreenEventSchema.safeParse({ ...ev, type }).success).toBe(true);
    }
    expect(ScreenEventSchema.safeParse({ ...ev, source: "os", type: "app_switched" }).success).toBe(true);
    expect(ScreenEventSchema.safeParse({ ...ev, rect: { x: 0, y: 0, w: 1, h: 1 } }).success).toBe(true);
  });

  it("rejects a rect outside 0..1 or reaching past the frame edge", () => {
    const base = { ...screenEventExample, app: "Microsoft PowerPoint" };
    for (const rect of [
      { x: -0.1, y: 0, w: 0.2, h: 0.2 },
      { x: 0.2, y: 0.2, w: 1.2, h: 0.1 },
      { x: 0.9, y: 0.1, w: 0.2, h: 0.1 },
      { x: 0.1, y: 0.95, w: 0.1, h: 0.1 },
    ]) {
      expect(ScreenEventSchema.safeParse({ ...base, rect }).success).toBe(false);
    }
  });

  // Regression guard: a session stored before the pivot has none of the new fields.
  const storedSession = {
    id: "s_old",
    kind: "capture",
    started_at: "2026-09-30T08:00:00.000Z",
    events: [screenEventExample],
    transcript: [],
    qa: [],
    off_record_ranges: [],
  };

  it("still parses a stored session without the new fields", () => {
    expect(SessionSchema.parse(storedSession)).toEqual(storedSession);
  });

  it("parses Session.teach and caps its lists", () => {
    const teach = { workmap_session_id: "s_old", mastered: ["1", "2"], practice: ["3"], interventions: 2, finished_at: "2026-10-03T21:00:00.000Z" };
    const s = SessionSchema.parse({ ...storedSession, kind: "teach", teach });
    expect(s.teach).toEqual(teach);
    expect(SessionSchema.safeParse({ ...storedSession, teach: { ...teach, interventions: -1 } }).success).toBe(false);
    const long = Array.from({ length: TEACH_LIST_MAX + 1 }, (_, i) => String(i));
    expect(SessionSchema.safeParse({ ...storedSession, teach: { ...teach, mastered: long } }).success).toBe(false);
  });

  it("newId prefixes a short random id", () => {
    expect(newId("ev")).toMatch(/^ev_[a-z0-9]+$/);
  });
});
