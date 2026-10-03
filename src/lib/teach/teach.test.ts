import { describe, expect, it } from "vitest";
import { SEED_INVOICES } from "@/lib/erp/seed";
import { WorkMapSchema, type Invoice } from "@/lib/types";
import { checkPendingAction, type DecideFn } from "./guardrailCheck";
import { recordFixed, recordPrediction, recordStop, scorePrediction, summary } from "./mastery";
import { SAMPLE_WORKMAP } from "./sampleWorkMap";

const T: Invoice = SEED_INVOICES.find((i) => i.id === "4630")!;
const CLEAN: Invoice = SEED_INVOICES.find((i) => i.id === "4498")!;
const low: DecideFn = async () => ({ answer: 0.1 });
const throwing: DecideFn = async () => {
  throw new Error("provider down");
};
const hanging: DecideFn = () => new Promise(() => {});

const check = (draft: Invoice, decide: DecideFn = low) =>
  checkPendingAction({ action: "save", draft, workmap: SAMPLE_WORKMAP, decide, timeoutMs: 20 });

describe("checkPendingAction", () => {
  it("blocks the EUR 7,200 equipment invoice on 4711 with the expert's capex quote", async () => {
    expect(T.amount_eur).toBe(7200);
    expect(T.cost_center).toBe("4711");
    const r = await check(T);
    expect(r.allow).toBe(false);
    expect(r.field).toBe("cost_center");
    expect(r.step?.screen_moment.field).toBe("cost_center");
    expect(r.explanation).toContain('"Equipment over €5,000 is always capex."');
    expect(r.explanation).toContain("Sabine");
    expect(r.explanation).toBe('Sabine would stop here. "Equipment over €5,000 is always capex."');
  });

  it("blocks 0400 without an asset number", async () => {
    const r = await check({ ...T, cost_center: "0400", asset_number: "" });
    expect(r.allow).toBe(false);
    expect(r.field).toBe("asset_number");
    expect(r.explanation).toContain("No asset number, no capex booking.");
  });

  it("allows 0400 with an asset number", async () => {
    const r = await check({ ...T, cost_center: "0400", asset_number: "A-2026-117" });
    expect(r.allow).toBe(true);
  });

  it("blocks a subsidiary save without second approval", async () => {
    const czech = SEED_INVOICES.find((i) => i.id === "4517")!;
    const r = await check(czech);
    expect(r).toMatchObject({ allow: false, field: "second_approval" });
    const routed = await checkPendingAction({ action: "second_approval", draft: czech, workmap: SAMPLE_WORKMAP, decide: low });
    expect(routed.allow).toBe(true);
  });

  for (const [name, decide] of [
    ["throwing", throwing],
    ["timing out", hanging],
  ] as const) {
    it(`decide ${name} does not block a valid save and does not unblock an invalid one`, async () => {
      expect((await check({ ...T, cost_center: "0400", asset_number: "A-1" }, decide)).allow).toBe(true);
      expect((await check(CLEAN, decide)).allow).toBe(true);
      const bad = await check(T, decide);
      expect(bad.allow).toBe(false);
      expect(bad.field).toBe("cost_center");
    });
  }

  it("rules alone block without calling decide", async () => {
    let called = false;
    const spy: DecideFn = async () => {
      called = true;
      return 0;
    };
    expect((await check(T, spy)).allow).toBe(false);
    expect(called).toBe(false);
  });

  it("decide probability 0.9 blocks an otherwise rule-clean draft", async () => {
    const r = await check(CLEAN, async () => ({ answer: 0.9 }));
    expect(r.allow).toBe(false);
    expect(r.probability).toBe(0.9);
    expect(r.step).toBeDefined();
    expect(r.explanation).toMatch(/^Sabine would stop here\. "/);
  });
});

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
