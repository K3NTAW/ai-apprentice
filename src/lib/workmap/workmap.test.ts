import { afterEach, describe, expect, it, vi } from "vitest";
import type { decideMany } from "@/lib/decide";
import { SCORE_THRESHOLD, type DecisionQuestionName, type DecisionResult, type Session, type WorkMap } from "@/lib/types";
import { exportGuardrailsMarkdown, gaps, isUnderstood, scoreWorkMap, synthesizeWorkMap, teachBackText } from "./index";
import { WORKMAP_URL } from "./synthesize";

const inv = (id: string) => ({ kind: "invoice", id });

// Invoice A (4471): re-coded to capex and saved. B (4502): held. C (4630): sent for second approval.
function fixture(): Session {
  return {
    id: "s_fixture",
    kind: "capture",
    started_at: "2026-10-03T09:00:00.000Z",
    expert: "Anna Muster",
    events: [
      { id: "e_a0", t: 10, source: "dom", type: "record_opened", entity: inv("4471") },
      { id: "e_a1", t: 20, source: "dom", type: "field_changed", entity: inv("4471"), field: "cost_center", from: "4711", to: "0400" },
      { id: "v_a1", t: 20.5, source: "vision", type: "field_changed", entity: inv("4471"), field: "cost_center", from: "4711", to: "0400", frame_ref: "f_0020.jpg" },
      { id: "e_a2", t: 30, source: "dom", type: "button_clicked", entity: inv("4471"), field: "save" },
      { id: "e_a3", t: 30, source: "dom", type: "status_changed", entity: inv("4471"), field: "approval_status", from: "open", to: "saved" },
      { id: "e_b0", t: 40, source: "dom", type: "record_opened", entity: inv("4502") },
      { id: "e_b1", t: 50, source: "dom", type: "button_clicked", entity: inv("4502"), field: "hold" },
      { id: "e_b2", t: 50, source: "dom", type: "status_changed", entity: inv("4502"), field: "approval_status", from: "open", to: "on_hold" },
      { id: "v_b2", t: 51, source: "vision", type: "status_changed", entity: inv("4502"), field: "approval_status", from: "open", to: "on_hold", frame_ref: "f_0051.jpg" },
      { id: "e_c0", t: 60, source: "dom", type: "record_opened", entity: inv("4630") },
      { id: "e_c1", t: 70, source: "dom", type: "button_clicked", entity: inv("4630"), field: "second_approval" },
      { id: "e_c2", t: 70, source: "dom", type: "status_changed", entity: inv("4630"), field: "approval_status", from: "open", to: "second_approval" },
    ],
    transcript: [
      { id: "t1", t: 22, speaker: "expert", text: "Equipment over €5,000 is always capex.", phase: "capture", redacted: true },
      { id: "t2", t: 23, speaker: "agent", text: "Why did you change the cost center?", phase: "capture", redacted: true },
      { id: "t3", t: 52, speaker: "expert", text: "This looks like a duplicate of 4498, so I hold it.", phase: "capture", redacted: true },
      { id: "t4", t: 72, speaker: "expert", text: "Anything above €7,000 needs a second pair of eyes.", phase: "capture", redacted: true },
    ],
    qa: [
      {
        id: "q1", t_question: 23, t_answer: 25, question: "Why did you change the cost center?",
        answer: "It is a machine, so it goes to the capex cost center 0400.", event_id: "e_a1", phase: "capture", about: "reason",
      },
      {
        id: "q2", t_question: 55, t_answer: 57, question: "Why did you hold 4502?",
        answer: "Same amount and same supplier as 4498 last week.", phase: "capture", about: "reason",
      },
      {
        id: "q3", t_question: 300, t_answer: 305, question: "Who releases a held invoice?",
        answer: "If you are not sure it is a duplicate, ask purchasing before releasing it.", phase: "debrief", about: "guardrail",
      },
    ],
    off_record_ranges: [],
  };
}

function modelResponse(out: unknown) {
  return vi.fn(async () =>
    Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }] }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const modelOutput = {
  task: "Code and approve supplier invoices",
  steps: [
    {
      title: "Re-code to capex",
      screen_moment: { t: 21.3, frame_ref: null, entity: "invoice 4471", field: "cost_center" },
      decision: "Change the cost center of invoice 4471 from 4711 to 0400",
      is_judgment_call: true,
      reason: { quote: "equipment  over €5,000 is ALWAYS capex", t: 22, source: "narration" },
      guardrails: [
        { rule: "Equipment over €5,000 goes to capex cost center 0400", kind: "limit", quote: "Equipment over €5,000 is always capex.", quote_ref: 22 },
        { rule: "Never pay a supplier twice", kind: "limit", quote: "We never pay twice, that is the golden rule.", quote_ref: 23 },
      ],
    },
    {
      title: "Hold duplicate",
      screen_moment: { t: 49, frame_ref: "made_up.jpg", entity: "invoice 4502", field: null },
      decision: "Put invoice 4502 on hold",
      is_judgment_call: true,
      reason: { quote: "Duplicates always get held because finance says so.", t: 52, source: "narration" },
      guardrails: [],
    },
  ],
  open_questions: [],
};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("synthesizeWorkMap with the model", () => {
  it("sends a strict json_schema request and verifies quotes and screen moments", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchImpl = modelResponse(modelOutput);
    const wm = await synthesizeWorkMap(fixture(), { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WORKMAP_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect(JSON.stringify(body.output_config.format.schema)).not.toMatch(/min|max/i);

    const [a, b] = wm.steps;
    // verbatim quote (case and whitespace differ) survives with its t
    expect(a.reason).toEqual({ quote: "equipment  over €5,000 is ALWAYS capex", t: 22, source: "narration" });
    // invented guardrail quote is dropped, verbatim one kept with quote_ref
    expect(a.guardrails).toHaveLength(1);
    expect(a.guardrails[0]).toMatchObject({ quote: "Equipment over €5,000 is always capex.", quote_ref: 22 });
    // invented reason quote is nulled
    expect(b.reason).toBeNull();
    // screen moments snap to the nearest real event and carry its frame_ref
    expect(a.screen_moment).toMatchObject({ t: 20.5, frame_ref: "f_0020.jpg", entity: "invoice 4471" });
    expect(b.screen_moment.t).toBe(50);
    expect(b.screen_moment.frame_ref).toBeUndefined();
    expect(wm.steps.map((s) => s.n)).toEqual([1, 2]);
  });

  it("falls back to the deterministic map when the model call fails", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const wm = await synthesizeWorkMap(fixture(), { fetchImpl });
    expect(wm.steps.length).toBeGreaterThanOrEqual(3);
  });
});

describe("fallback synthesis without an API key", () => {
  it("yields steps for the cost center change, the hold and the second approval", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const wm = await synthesizeWorkMap(fixture(), { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    const decisions = wm.steps.map((s) => s.decision);
    expect(decisions).toContain("Change the cost center of invoice 4471 from 4711 to 0400");
    expect(decisions).toContain("Put invoice 4502 on hold");
    expect(decisions).toContain("Send invoice 4630 for second approval");

    const recode = wm.steps.find((s) => s.screen_moment.field === "cost_center")!;
    expect(recode.reason).toEqual({ quote: "It is a machine, so it goes to the capex cost center 0400.", t: 25, source: "live_question" });
    expect(recode.screen_moment.frame_ref).toBeUndefined();
    const hold = wm.steps.find((s) => s.screen_moment.field === "hold")!;
    expect(hold.reason?.quote).toBe("Same amount and same supplier as 4498 last week.");
    const second = wm.steps.find((s) => s.screen_moment.field === "second_approval")!;
    expect(second.reason).toBeNull();
    expect(wm.steps.map((s) => s.n)).toEqual(wm.steps.map((_, i) => i + 1));
  });
});

type Scores = Partial<Record<DecisionQuestionName, number>>;
function fakeDecide(byStep: Record<number, Scores>) {
  return vi.fn(async (qs: DecisionQuestionName[], state: unknown) => {
    const n = (state as { step: { n: number } }).step.n;
    const out = {} as Record<DecisionQuestionName, DecisionResult>;
    for (const q of qs) {
      out[q] = { question: q, answer: byStep[n]?.[q] ?? 0, confidence: 0.9, provider: "heuristic", latency_ms: 1 };
    }
    return out;
  }) as unknown as typeof decideMany & ReturnType<typeof vi.fn>;
}

describe("scoring loop and gaps", () => {
  async function fallbackMap(): Promise<WorkMap> {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    return synthesizeWorkMap(fixture());
  }

  it("scores each step and skips the guardrail call for a non-judgment step with a reason", async () => {
    const wm = await fallbackMap();
    const save = wm.steps.find((s) => s.screen_moment.field === "save")!;
    save.reason = { quote: "Equipment over €5,000 is always capex.", t: 22, source: "narration" };
    const decideImpl = fakeDecide({ [save.n]: { step_reason_captured: 0.9 } });
    const scored = await scoreWorkMap(wm, fixture(), { decideImpl });
    const saveCall = decideImpl.mock.calls.find((c) => (c[1] as { step: { n: number } }).step.n === save.n)!;
    expect(saveCall[0]).toEqual(["step_reason_captured"]);
    expect(Array.isArray((saveCall[1] as { related_transcript: unknown[] }).related_transcript)).toBe(true);
    const other = decideImpl.mock.calls.find((c) => (c[1] as { step: { n: number } }).step.n !== save.n)!;
    expect(other[0]).toEqual(["step_reason_captured", "step_guardrail_captured"]);
    expect(scored.steps.find((s) => s.n === save.n)!.scores).toEqual({ reason_captured: 0.9, guardrail_captured: 1 });
  });

  it("sorts gaps lowest first, names the on-screen object, and clears them at the threshold", async () => {
    const session = fixture();
    const wm = await fallbackMap();
    const n = (field: string) => wm.steps.find((s) => s.screen_moment.field === field)!.n;
    const scored = await scoreWorkMap(wm, session, {
      decideImpl: fakeDecide({
        [n("cost_center")]: { step_reason_captured: 0.2, step_guardrail_captured: 0.8 },
        [n("save")]: { step_reason_captured: 0.9, step_guardrail_captured: 0.9 },
        [n("hold")]: { step_reason_captured: 0.8, step_guardrail_captured: 0.1 },
        [n("second_approval")]: { step_reason_captured: 0.5, step_guardrail_captured: 0.6 },
      }),
    });
    const list = gaps(scored, session);
    expect(list.map((g) => g.score)).toEqual([0.1, 0.2, 0.5, 0.6]);
    expect(list.every((g) => g.score < SCORE_THRESHOLD)).toBe(true);
    expect(list[0]).toMatchObject({ step_n: n("hold"), missing: "guardrail" });
    expect(list[0].suggested_question).toBe("You held invoice 4502. Is that for every supplier, and who decides when to release it?");
    expect(list[1].suggested_question).toBe("You changed the cost center of invoice 4471 from 4711 to 0400. What made you do that?");
    expect(list[2].suggested_question).toContain("invoice 4630");
    expect(isUnderstood(scored)).toBe(false);

    const done = await scoreWorkMap(scored, session, {
      decideImpl: fakeDecide(
        Object.fromEntries(scored.steps.map((s) => [s.n, { step_reason_captured: SCORE_THRESHOLD, step_guardrail_captured: 1 }])),
      ),
    });
    expect(gaps(done, session)).toEqual([]);
    expect(isUnderstood(done)).toBe(true);
    expect(isUnderstood({ ...done, steps: [] })).toBe(false);
  });
});

function richMap(stepCount = 4): WorkMap {
  const steps = Array.from({ length: stepCount }, (_, i) => ({
    n: i + 1,
    title: `Step ${i + 1}`,
    screen_moment: { t: 20 + i * 10, entity: "invoice 4471", field: "cost_center" },
    decision: `Change the cost center of invoice 4471 from 4711 to 0400 because the equipment is a long lived asset number ${i}`,
    is_judgment_call: true,
    reason: { quote: "Equipment over €5,000 is always capex.", t: 22, source: "narration" as const },
    guardrails: [
      { rule: "Equipment over €5,000 always goes to cost center 0400 with an asset number", kind: "limit" as const, quote: "Equipment over €5,000 is always capex.", quote_ref: 22 },
      { rule: "If a duplicate is unclear, ask purchasing before releasing the hold", kind: "stop_and_ask" as const, quote: "ask purchasing before releasing it.", quote_ref: 305 },
      { rule: "Credit notes skip the second approval", kind: "exception" as const, quote: "Credit notes are the exception.", quote_ref: 310 },
    ],
    scores: { reason_captured: 1, guardrail_captured: 1 },
  }));
  return { task: "Code and approve supplier invoices", expert: "Anna", confirmed_by_expert: false, steps, open_questions: [] };
}

describe("teachBackText", () => {
  const wordCount = (s: string) => s.split(/\s+/).filter(Boolean).length;

  it("stays under 130 words and ends with the confirmation question", () => {
    for (const map of [richMap(3), richMap(12)]) {
      const text = teachBackText(map);
      expect(wordCount(text)).toBeLessThan(130);
      expect(text.endsWith("Did I get that right?")).toBe(true);
    }
  });

  it("has one sentence per step and mentions guardrails", () => {
    const text = teachBackText(richMap(3));
    expect(text).toMatch(/^Here is what I learned\. First you /);
    expect(text.match(/(First|Then|Finally) you/g)).toHaveLength(3);
    expect(text).toContain("the rule is");
  });
});

describe("exportGuardrailsMarkdown", () => {
  it("lists every guardrail with quote and timestamp, plus a stop-and-ask section", () => {
    const map = richMap(2);
    const md = exportGuardrailsMarkdown(map);
    for (const g of map.steps.flatMap((s) => s.guardrails)) expect(md).toContain(g.rule);
    expect(md).toContain("## Guardrails (never break)");
    expect(md).toContain("## Stop and ask a human when");
    const stop = md.slice(md.indexOf("## Stop and ask a human when"));
    expect(stop).toContain("ask purchasing before releasing the hold");
    expect(md).toContain('"Equipment over €5,000 is always capex." [00:22]');
    expect(md).toContain("1. **Step 1**");
    expect(md).toContain("# Agent instructions: Code and approve supplier invoices");
  });
});
