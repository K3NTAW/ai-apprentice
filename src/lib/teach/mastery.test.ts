import { describe, expect, it } from "vitest";
import { SessionSchema, TEACH_LIST_MAX, TeachProgressSchema } from "@/lib/types";
import { EMAIL_FLOW_WORKMAP } from "./fixtures";
import { buildTeachProgress, recordPrediction, recordStop, scorePrediction, summary } from "./mastery";

const steps = EMAIL_FLOW_WORKMAP.steps;
const NOW = Date.parse("2026-10-03T21:30:00Z");

describe("mastery", () => {
  it("correct predictions are mastered; a stop or a wrong prediction goes to practice", () => {
    let m = recordPrediction({}, 1, true);
    m = recordPrediction(m, 3, true);
    m = recordStop(m, 3);
    m = recordPrediction(m, 4, false);
    const s = summary(m, steps);
    expect(s.mastered).toEqual([steps[0].title]);
    expect(s.practice).toEqual([steps[2].title, steps[3].title]);
    expect(s.text).toContain("Mastered: Open the purchase request email.");
    expect(s.text).toContain("Practice next:");
  });

  it("scores a prediction by keyword match against the decision", () => {
    expect(scorePrediction("it's equipment over 5000 so capex code 0400", steps[2])).toBe(true);
    expect(scorePrediction("just save it", steps[2])).toBe(false);
  });

  it("stores Session.teach with workmap_session_id, mastered, practice, interventions, finished_at", () => {
    let m = recordPrediction({}, 1, true);
    m = recordStop(m, 3);
    const teach = buildTeachProgress({ workmapSessionId: "cap_1", state: m, steps, interventions: 1, now: () => NOW });
    expect(teach).toEqual({
      workmap_session_id: "cap_1",
      mastered: ["1"],
      practice: ["3"],
      interventions: 1,
      finished_at: "2026-10-03T21:30:00.000Z",
    });
    const session = SessionSchema.parse({
      id: "teach_1",
      kind: "teach",
      started_at: "2026-10-03T21:00:00.000Z",
      events: [],
      transcript: [],
      qa: [],
      off_record_ranges: [],
      teach,
    });
    expect(session.teach).toEqual(teach);
  });

  it("unions mastered with the stored list, adds interventions and respects TEACH_LIST_MAX", () => {
    const previous = { workmap_session_id: "cap_1", mastered: ["2"], practice: [], interventions: 2 };
    const teach = buildTeachProgress({ workmapSessionId: "cap_1", state: recordPrediction({}, 1, true), steps, interventions: 1, previous, now: () => NOW });
    expect(teach.mastered).toEqual(["2", "1"]);
    expect(teach.interventions).toBe(3);
    const many = Array.from({ length: TEACH_LIST_MAX + 5 }, (_, i) => ({ n: i + 1 }));
    const state = Object.fromEntries(many.map((s) => [s.n, { predicted: true, stopped: false }]));
    const big = buildTeachProgress({ workmapSessionId: "cap_1", state, steps: many, interventions: 0, now: () => NOW });
    expect(big.mastered).toHaveLength(TEACH_LIST_MAX);
    expect(TeachProgressSchema.safeParse(big).success).toBe(true);
  });
});
