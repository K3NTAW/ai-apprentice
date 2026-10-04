import { afterEach, describe, expect, it, vi } from "vitest";
import type { decideMany } from "@/lib/decide";
import { emailFlowSession, navigationOnlySession, OUTLOOK, POWERPOINT, slideFlowSession } from "@/lib/fixtures/flows";
import { SCORE_THRESHOLD, type DecisionQuestionName, type DecisionResult, type WorkMap } from "@/lib/types";
import { exportGuardrailsMarkdown, gaps, isUnderstood, scoreWorkMap, synthesizeWorkMap, teachBackText } from "./index";
import { WORKMAP_URL } from "./synthesize";

function modelResponse(out: unknown) {
  return vi.fn(async () =>
    Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }] }),
  ) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

const modelOutput = {
  task: "Forward and flag offers in Outlook",
  steps: [
    {
      title: "Forward the offer",
      screen_moment: { t: 31.3, frame_ref: null, app: "Outlook", entity: "email Offer Q3 from Muster AG", field: "forward" },
      decision: "Forward email Offer Q3 to the controller in Microsoft Outlook",
      is_judgment_call: true,
      reason: { quote: "offers above ten thousand  ALWAYS go to the controller first", t: 32, source: "narration" },
      guardrails: [
        { rule: "Offers above 10k go to the controller first", kind: "limit", quote: "Offers above ten thousand always go to the controller first.", quote_ref: 32 },
        { rule: "Never reply before the controller saw it", kind: "limit", quote: "I never reply before that.", quote_ref: 33 },
      ],
    },
    {
      title: "Flag it",
      screen_moment: { t: 39, frame_ref: "made_up.jpg", app: null, entity: "email Offer Q3 from Muster AG", field: null },
      decision: "Flag email Offer Q3",
      is_judgment_call: true,
      reason: { quote: "Flags are mandatory by policy.", t: 42, source: "narration" },
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
  it("sends a strict json_schema request with app and window, and verifies quotes and screen moments", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const fetchImpl = modelResponse(modelOutput);
    const wm = await synthesizeWorkMap(emailFlowSession(), { fetchImpl });

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(WORKMAP_URL);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-key");
    const body = JSON.parse(String(init.body));
    expect(body.model).toBe("claude-opus-5-5");
    expect(body.output_config.format.type).toBe("json_schema");
    expect(body.output_config.format.schema.additionalProperties).toBe(false);
    expect(JSON.stringify(body.output_config.format.schema)).not.toMatch(/min|max/i);
    expect(body.output_config.format.schema.properties.steps.items.properties.screen_moment.properties.app).toBeDefined();
    expect(body.messages[0].content).toContain('"app":"Microsoft Outlook"');
    expect(body.messages[0].content).toContain('"window":"FW: Offer Q3 - Message"');

    const [a, b] = wm.steps;
    expect(a.reason).toEqual({ quote: "offers above ten thousand  ALWAYS go to the controller first", t: 32, source: "narration" });
    expect(a.guardrails).toHaveLength(1);
    expect(a.guardrails[0]).toMatchObject({ quote: "Offers above ten thousand always go to the controller first.", quote_ref: 32 });
    expect(b.reason).toBeNull();
    // screen moments snap to the nearest real event and carry its app and frame_ref
    expect(a.screen_moment).toMatchObject({ t: 30, frame_ref: "frames/0030.jpg", app: OUTLOOK, entity: "email Offer Q3 from Muster AG" });
    expect(b.screen_moment).toMatchObject({ t: 40, app: OUTLOOK });
    expect(wm.steps.map((s) => s.n)).toEqual([1, 2]);
  });

  it("falls back to the deterministic map when the model call fails", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response("boom", { status: 500 })) as unknown as typeof fetch;
    const wm = await synthesizeWorkMap(slideFlowSession(), { fetchImpl });
    expect(wm.steps).toHaveLength(2);
  });
});

describe("fallback synthesis without an API key", () => {
  const fallback = async (session = emailFlowSession()) => {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const wm = await synthesizeWorkMap(session, { fetchImpl });
    expect(fetchImpl).not.toHaveBeenCalled();
    return wm;
  };

  it("email flow: forward to the controller and flag, both naming Outlook and the email", async () => {
    const wm = await fallback();
    expect(wm.task).toBe(`Forward and flag email in ${OUTLOOK}`);
    expect(wm.steps.map((s) => s.title)).toEqual(["Forward email", "Flag email"]);
    expect(wm.steps.map((s) => s.decision)).toEqual([
      `Forward email Offer Q3 from Muster AG to controller@example.com in ${OUTLOOK}`,
      `Flag email Offer Q3 from Muster AG in ${OUTLOOK}`,
    ]);
    for (const s of wm.steps) {
      expect(s.screen_moment.app).toBe(OUTLOOK);
      expect(s.screen_moment.entity.split(" ")[0]).toBe("email");
      expect(s.is_judgment_call).toBe(true);
    }
    const [forward, flag] = wm.steps;
    expect(forward.screen_moment).toMatchObject({ t: 30, frame_ref: "frames/0030.jpg", field: "forward" });
    expect(forward.reason).toEqual({ quote: "Offers above ten thousand always go to the controller first.", t: 35, source: "live_question" });
    expect(forward.guardrails).toEqual([
      { rule: "If the controller is away, ask the deputy before replying.", kind: "stop_and_ask", quote: "If the controller is away, ask the deputy before replying.", quote_ref: 305 },
    ]);
    expect(flag.reason).toBeNull();
  });

  it("slide flow: delete a slide and change a number, both naming PowerPoint and the slide", async () => {
    const wm = await fallback(slideFlowSession());
    expect(wm.task).toBe(`Delete and change slide in ${POWERPOINT}`);
    const [del, change] = wm.steps;
    expect(del).toMatchObject({ title: "Delete slide", decision: `Delete slide 4 in ${POWERPOINT}`, is_judgment_call: true });
    expect(del.screen_moment).toMatchObject({ app: POWERPOINT, entity: "slide 4", frame_ref: "frames/0015.jpg" });
    expect(change.decision).toBe(`Change the revenue growth of slide 2 from 12% to 15% in ${POWERPOINT}`);
    expect(change.screen_moment).toMatchObject({ app: POWERPOINT, entity: "slide 2", field: "revenue_growth" });
    expect(change.reason?.quote).toBe("The final numbers came in this morning.");
    expect(wm.steps.map((s) => s.n)).toEqual([1, 2]);
  });

  it("navigation only: one Open step per object, no judgment calls", async () => {
    const wm = await fallback(navigationOnlySession());
    expect(wm.task).toBe(`Open folder and email in ${OUTLOOK}`);
    expect(wm.steps.map((s) => s.decision)).toEqual([
      `Open folder Archive in ${OUTLOOK}`,
      `Open email Offer Q3 from Muster AG in ${OUTLOOK}`,
    ]);
    expect(wm.steps.every((s) => !s.is_judgment_call && s.screen_moment.app === OUTLOOK)).toBe(true);
  });

  it("no events gives the default title", async () => {
    const wm = await fallback({ ...emailFlowSession(), events: [] });
    expect(wm).toMatchObject({ task: "Recorded task", steps: [] });
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
  async function fallbackMap(session = emailFlowSession()): Promise<WorkMap> {
    vi.stubEnv("ANTHROPIC_API_KEY", "");
    return synthesizeWorkMap(session);
  }

  it("scores each step and skips the guardrail call for a non-judgment step with a reason", async () => {
    const wm = await fallbackMap();
    const flag = wm.steps[1];
    flag.is_judgment_call = false;
    flag.reason = { quote: "I flag it so I chase it on Friday.", t: 42, source: "narration" };
    const decideImpl = fakeDecide({ [flag.n]: { step_reason_captured: 0.9 } });
    const scored = await scoreWorkMap(wm, emailFlowSession(), { decideImpl });
    const flagCall = decideImpl.mock.calls.find((c) => (c[1] as { step: { n: number } }).step.n === flag.n)!;
    expect(flagCall[0]).toEqual(["step_reason_captured"]);
    const other = decideImpl.mock.calls.find((c) => (c[1] as { step: { n: number } }).step.n !== flag.n)!;
    expect(other[0]).toEqual(["step_reason_captured", "step_guardrail_captured"]);
    expect(scored.steps[1].scores).toEqual({ reason_captured: 0.9, guardrail_captured: 1 });
  });

  it("sorts gaps lowest first, names the app object, and clears them at the threshold", async () => {
    const session = slideFlowSession();
    const wm = await fallbackMap(session);
    const scored = await scoreWorkMap(wm, session, {
      decideImpl: fakeDecide({
        1: { step_reason_captured: 0.2, step_guardrail_captured: 0.1 },
        2: { step_reason_captured: 0.5, step_guardrail_captured: 0.9 },
      }),
    });
    const list = gaps(scored, session);
    expect(list.map((g) => g.score)).toEqual([0.1, 0.2, 0.5]);
    expect(list[0]).toMatchObject({ step_n: 1, missing: "guardrail" });
    expect(list[0].suggested_question).toBe("You deleted slide 4. Is there anything you would never delete, or a case where you would ask first?");
    expect(list[1].suggested_question).toBe("You deleted slide 4. What made you delete it?");
    expect(list[2].suggested_question).toBe("You changed the revenue growth of slide 2 from 12% to 15%. What made you do that?");
    expect(isUnderstood(scored)).toBe(false);

    const done = await scoreWorkMap(scored, session, {
      decideImpl: fakeDecide({ 1: { step_reason_captured: SCORE_THRESHOLD, step_guardrail_captured: 1 }, 2: { step_reason_captured: 1, step_guardrail_captured: 1 } }),
    });
    expect(gaps(done, session)).toEqual([]);
    expect(isUnderstood(done)).toBe(true);
    expect(isUnderstood({ ...done, steps: [] })).toBe(false);
  });

  it("asks why that person for a forwarded email", async () => {
    const session = emailFlowSession();
    const wm = await fallbackMap(session);
    const [first] = gaps(wm, session);
    expect(first.suggested_question).toBe("You sent email Offer Q3 from Muster AG to controller@example.com. Why that person?");
  });
});

function richMap(stepCount = 4): WorkMap {
  const steps = Array.from({ length: stepCount }, (_, i) => ({
    n: i + 1,
    title: `Step ${i + 1}`,
    screen_moment: { t: 20 + i * 10, app: POWERPOINT, entity: "slide 2", field: "revenue_growth" },
    decision: `Change the revenue growth on slide 2 from 12% to 15% because the final numbers came in this morning ${i}`,
    is_judgment_call: true,
    reason: { quote: "The final numbers came in this morning.", t: 29, source: "live_question" as const },
    guardrails: [
      { rule: "Numbers on board slides only change with the final figures from finance", kind: "limit" as const, quote: "Only final numbers go on board slides.", quote_ref: 30 },
      { rule: "If the figure moves by more than 5 points, ask the CFO before sending", kind: "stop_and_ask" as const, quote: "more than five points, I ask the CFO.", quote_ref: 305 },
      { rule: "Draft decks may keep estimates", kind: "exception" as const, quote: "Drafts are the exception.", quote_ref: 310 },
    ],
    scores: { reason_captured: 1, guardrail_captured: 1 },
  }));
  return { task: "Update the board deck in Microsoft PowerPoint", expert: "Ben", confirmed_by_expert: false, steps, open_questions: [] };
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
  it("lists every guardrail with quote and timestamp, the app per step, plus a stop-and-ask section", () => {
    const map = richMap(2);
    const md = exportGuardrailsMarkdown(map);
    for (const g of map.steps.flatMap((s) => s.guardrails)) expect(md).toContain(g.rule);
    expect(md).toContain("## Guardrails (never break)");
    expect(md).toContain("## Stop and ask a human when");
    const stop = md.slice(md.indexOf("## Stop and ask a human when"));
    expect(stop).toContain("ask the CFO before sending");
    expect(md).toContain('"Only final numbers go on board slides." [00:30]');
    expect(md).toContain("1. **Step 1**");
    expect(md).toContain(`(${POWERPOINT}: slide 2, revenue growth [00:20])`);
    expect(md).toContain("# Agent instructions: Update the board deck in Microsoft PowerPoint");
  });
});

describe("shortcuts in the Work Map (agents wave A5)", async () => {
  const { fallbackWorkMap, verifyWorkMap } = await import("./synthesize");
  const { SessionSchema } = await import("@/lib/types");
  const ANSWER = "It sends right away, so I never forget the attachment check.";
  const session = SessionSchema.parse({
    id: "s1",
    kind: "capture",
    started_at: "2026-10-04T08:00:00Z",
    expert: "Sabine",
    events: [
      { id: "ev_sc1", t: 10, source: "os", type: "shortcut_used", entity: { kind: "shortcut", id: "Cmd+Enter" }, chord: "Cmd+Enter", app: OUTLOOK, effect_ids: ["ev_out"] },
      { id: "ev_out", t: 11, source: "vision", type: "item_sent", entity: { kind: "email", id: "Offer Q3" }, to: "controller", app: OUTLOOK },
      { id: "ev_sc2", t: 40, source: "os", type: "shortcut_used", entity: { kind: "shortcut", id: "Cmd+Enter" }, chord: "Cmd+Enter", app: OUTLOOK },
      { id: "ev_sc3", t: 50, source: "os", type: "shortcut_used", entity: { kind: "shortcut", id: "Cmd+Shift+V" }, chord: "Cmd+Shift+V", app: "Microsoft Excel" },
    ],
    transcript: [],
    qa: [
      { id: "qa1", t_question: 12, t_answer: 15, question: `You pressed Cmd+Enter in ${OUTLOOK} there. What does it do for you and why that way?`, answer: ANSWER, event_id: "ev_sc1", phase: "capture", about: "other" },
    ],
    off_record_ranges: [],
  });

  it("fills shortcuts from linked events and the expert's answer; first_t and count from code; deduped by chord+app", () => {
    const wm = fallbackWorkMap(session);
    expect(wm.steps).toHaveLength(1);
    expect(wm.shortcuts).toEqual([
      {
        chord: "Cmd+Enter",
        app: OUTLOOK,
        effect: `email Offer Q3 sent to controller in ${OUTLOOK}`,
        effect_type: "item_sent",
        why: { quote: ANSWER, t: 15 },
        first_t: 10,
        count: 2,
        step: 1,
      },
      { chord: "Cmd+Shift+V", app: "Microsoft Excel", effect: "effect not seen on screen", first_t: 50, count: 1 },
    ]);
    expect(wm.open_questions).toContain("You pressed Cmd+Shift+V in Microsoft Excel there. What does it do for you and why that way?");
  });

  it("verify drops a why quote the expert never said", () => {
    const wm = fallbackWorkMap(session);
    const forged = { ...wm, shortcuts: wm.shortcuts!.map((s) => ({ ...s, why: { quote: "Because the manual says so.", t: 15 } })) };
    expect(verifyWorkMap(forged, session).shortcuts!.every((s) => s.why === undefined)).toBe(true);
    expect(verifyWorkMap(wm, session).shortcuts![0].why?.quote).toBe(ANSWER);
  });

  it("exports the shortcuts in the guardrails markdown", () => {
    const md = exportGuardrailsMarkdown(fallbackWorkMap(session));
    expect(md).toContain("## Keyboard shortcuts");
    expect(md).toContain(`- \`Cmd+Enter\` in ${OUTLOOK}: email Offer Q3 sent to controller in ${OUTLOOK} (step 1, used 2x, first at 00:10). Why: "${ANSWER}" [00:15]`);
    expect(md).toContain("- `Cmd+Shift+V` in Microsoft Excel: effect not seen on screen (used 1x, first at 00:50). Why: not stated by the expert.");
  });

  it("old Work Maps without shortcuts export without the section", () => {
    const old: WorkMap = { ...fallbackWorkMap(session) };
    delete old.shortcuts;
    expect(exportGuardrailsMarkdown(old)).not.toContain("Keyboard shortcuts");
  });
});
