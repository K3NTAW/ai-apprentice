import { describe, expect, it } from "vitest";
import type { WorkMap, WorkMapStep } from "@/lib/types";
import { counts, countsLine, formatT, formatZurich, sourceLabel } from "./view";

function step(n: number, judgment: boolean, guardrails: number): WorkMapStep {
  return {
    n,
    title: `step ${n}`,
    screen_moment: { t: n * 30, entity: "invoice 4471" },
    decision: "d",
    is_judgment_call: judgment,
    reason: null,
    guardrails: Array.from({ length: guardrails }, (_, i) => ({ rule: `r${i}`, quote_ref: n * 30, kind: "limit" as const })),
    scores: { reason_captured: 0.5, guardrail_captured: 0.5 },
  };
}

const fixture: WorkMap = {
  task: "Approve supplier invoices",
  expert: "Sabine",
  confirmed_by_expert: false,
  steps: [step(1, false, 0), step(2, true, 2), step(3, false, 0), step(4, true, 1), step(5, false, 0), step(6, true, 1), step(7, false, 0)],
  open_questions: [],
};

describe("workmap view helpers", () => {
  it("counts steps, judgment calls and guardrails", () => {
    expect(counts(fixture)).toEqual({ steps: 7, judgmentCalls: 3, guardrails: 4 });
    expect(countsLine(fixture)).toBe("7 steps · 3 judgment calls · 4 guardrails");
  });

  it("formats seconds as mm:ss", () => {
    expect(formatT(192)).toBe("03:12");
    expect(formatT(0)).toBe("00:00");
    expect(formatT(5.9)).toBe("00:05");
  });

  it("labels reason sources", () => {
    expect(sourceLabel("live_question")).toBe("live question");
    expect(sourceLabel("debrief")).toBe("debrief");
  });

  it("formats started_at in Europe/Zurich, 24h", () => {
    expect(formatZurich("2026-10-03T13:05:00.000Z")).toBe("2026-10-03 15:05");
  });
});
