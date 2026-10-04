import { describe, expect, it } from "vitest";
import type { WorkMap, WorkMapStep } from "@/lib/types";
import { mergeWorkMaps } from "./combine";

const step = (n: number, title: string, over: Partial<WorkMapStep> = {}): WorkMapStep => ({
  n,
  title,
  screen_moment: { t: n * 10, app: "SAP", entity: "invoice" },
  decision: "approve",
  is_judgment_call: false,
  reason: null,
  guardrails: [],
  scores: { reason_captured: 0, guardrail_captured: 0 },
  ...over,
});
const map = (steps: WorkMapStep[], open: string[] = []): WorkMap => ({ task: "Approve invoices", expert: "Sabine", confirmed_by_expert: true, steps, open_questions: open });

const oldReason = { quote: "Because the PO must match.", t: 12, source: "debrief" as const };
const oldGuard = { rule: "Over 10k needs a second approval", quote_ref: 3, kind: "limit" as const, quote: "anything over ten thousand" };

const current = map(
  [
    step(1, "Open invoice", { reason: oldReason, guardrails: [oldGuard], scores: { reason_captured: 1, guardrail_captured: 0.8 } }),
    step(2, "Post invoice", { screen_moment: { t: 30, app: "SAP", entity: "posting" } }),
  ],
  ["Who covers holidays?"],
);

describe("mergeWorkMaps", () => {
  const next = map([
    step(1, "Open invoice", {
      reason: { quote: "To see the vendor first.", t: 4, source: "live_question" },
      decision: "reject",
      guardrails: [
        { rule: "over 10k needs a second approval!", quote_ref: 9, kind: "limit", quote: "dup" },
        { rule: "Stop when the IBAN changed", quote_ref: 7, kind: "stop_and_ask", quote: "if the IBAN is new, call them" },
      ],
      scores: { reason_captured: 1, guardrail_captured: 1 },
    }),
    step(2, "Check VAT", { screen_moment: { t: 20, app: "SAP", entity: "vat" }, reason: { quote: "VAT ids drift.", t: 21, source: "narration" } }),
    step(3, "Post invoice", { screen_moment: { t: 30, app: "SAP", entity: "posting" } }),
  ]);
  const r = mergeWorkMaps(current, next);

  it("keeps the old reason and guardrails with their quotes and adds the new guardrail with its own quote", () => {
    const s1 = r.workmap.steps[0]!;
    expect(s1.reason).toEqual(oldReason);
    expect(s1.decision).toBe("approve");
    expect(s1.guardrails).toEqual([oldGuard, { rule: "Stop when the IBAN changed", quote_ref: 7, kind: "stop_and_ask", quote: "if the IBAN is new, call them" }]);
    expect(s1.scores).toEqual({ reason_captured: 1, guardrail_captured: 1 });
  });

  it("inserts new steps in order and renumbers", () => {
    expect(r.workmap.steps.map((s) => [s.n, s.title])).toEqual([
      [1, "Open invoice"],
      [2, "Check VAT"],
      [3, "Post invoice"],
    ]);
    expect(r.workmap.steps[1]!.reason?.quote).toBe("VAT ids drift.");
  });

  it("lists conflicts as open questions next to the old ones", () => {
    expect(r.conflicts).toHaveLength(2);
    expect(r.conflicts[0]).toContain("Because the PO must match.");
    expect(r.conflicts[0]).toContain("To see the vendor first.");
    expect(r.conflicts[1]).toContain('"reject"');
    expect(r.workmap.open_questions).toEqual(["Who covers holidays?", ...r.conflicts]);
    expect(r.changes).toContain('New step "Check VAT" added as step 2.');
  });

  it("takes a new reason where the old step had none", () => {
    const m = mergeWorkMaps(current, map([step(1, "Post invoice", { screen_moment: { t: 1, app: "SAP", entity: "posting" }, reason: oldReason })]));
    expect(m.workmap.steps[1]!.reason).toEqual(oldReason);
    expect(m.conflicts).toEqual([]);
    expect(m.workmap.steps).toHaveLength(2);
  });
});
