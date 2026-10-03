import { describe, expect, it } from "vitest";
import { WorkMapSchema } from "@/lib/types";
import { recordFixed, recordPrediction, recordStop, scorePrediction, summary } from "./mastery";
import { SAMPLE_WORKMAP } from "./sampleWorkMap";

describe("SAMPLE_WORKMAP", () => {
  it("parses and has 7 steps, 3 judgment calls, 4 guardrails", () => {
    const wm = WorkMapSchema.parse(SAMPLE_WORKMAP);
    expect(wm.steps).toHaveLength(7);
    expect(wm.steps.filter((s) => s.is_judgment_call)).toHaveLength(3);
    expect(wm.steps.flatMap((s) => s.guardrails)).toHaveLength(4);
    const quotes = wm.steps.flatMap((s) => [s.reason?.quote, ...s.guardrails.map((g) => g.quote)]);
    for (const q of [
      "Equipment over €5,000 is always capex.",
      "No asset number, no capex booking.",
      "That supplier double-bills every December, so I hold it until purchasing confirms.",
      "Anything from the Czech subsidiary goes for second approval.",
      "Unknown supplier: stop and ask the controller.",
    ])
      expect(quotes).toContain(q);
  });
});

describe("mastery", () => {
  it("lists stopped-then-fixed under practice_next and correct predictions under mastered", () => {
    const steps = SAMPLE_WORKMAP.steps;
    let m = recordPrediction({}, 6, true);
    m = recordPrediction(m, 3, true);
    m = recordStop(m, 3);
    m = recordFixed(m);
    expect(m[3]).toMatchObject({ stopped: true, fixed: true });
    const s = summary(m, steps);
    expect(s.mastered).toEqual([steps[5].title]);
    expect(s.practice_next).toEqual([steps[2].title]);
    expect(s.text).toContain("Practice next");
  });

  it("scores a prediction by keyword match against the decision", () => {
    const step = SAMPLE_WORKMAP.steps[2];
    expect(scorePrediction("change the cost center to 0400, it's capex", step)).toBe(true);
    expect(scorePrediction("just save it", step)).toBe(false);
  });
});
