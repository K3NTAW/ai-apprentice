import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/decide/route";
import { DecisionResultSchema } from "../types";
import { decide, decideMany } from "./index";
import { JEV_URL } from "./jev";
import { LLM_URL } from "./llm";

type Call = { url: string; init: RequestInit };

function mockFetch(...responses: (Response | Error)[]) {
  const calls: Call[] = [];
  const impl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses.shift();
    if (!next) throw new Error("no more mocked responses");
    if (next instanceof Error) throw next;
    return next;
  });
  return { fetchImpl: impl as unknown as typeof fetch, calls };
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const llmReply = (obj: unknown) => json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(obj) }] });

// A pending value over the limit the expert stated.
const overLimitState = { pending: { type: "field_changed", value: 7200, limit: 5000 } };

beforeEach(() => {
  vi.stubEnv("JEV_API_KEY", "");
  vi.stubEnv("ANTHROPIC_API_KEY", "");
  vi.stubEnv("DECIDE_PROVIDER", "");
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("jev provider", () => {
  beforeEach(() => vi.stubEnv("JEV_API_KEY", "jev-test"));

  it("sends one request with choice and noul questions, bearer header and model", async () => {
    const { fetchImpl, calls } = mockFetch(
      json({
        answers: {
          event_class: { choice: "judgment_call", probabilities: { routine: 0.1, judgment_call: 0.8, possible_guardrail: 0.1 } },
          screen_explains_it: { noul: 0.2 },
        },
      }),
    );
    const state = { event: { type: "field_changed", field: "cost_center" } };
    const res = await decideMany(["event_class", "screen_explains_it"], state, { fetchImpl });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe(JEV_URL);
    expect(calls[0].init.method).toBe("POST");
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer jev-test");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.state).toBe(JSON.stringify(state));
    expect(body.model).toBe("jev-latest");
    expect(body.questions.event_class.type).toBe("choice");
    expect(Object.keys(body.questions.event_class.criteria)).toEqual(["routine", "judgment_call", "possible_guardrail"]);
    expect(typeof body.questions.event_class.instructions).toBe("string");
    expect(body.questions.screen_explains_it).toEqual({ type: "noul", instructions: expect.any(String) });

    expect(res.event_class).toMatchObject({ answer: "judgment_call", confidence: 0.8, provider: "jev" });
    expect(res.screen_explains_it.answer).toBe(0.2);
    expect(res.screen_explains_it.confidence).toBeCloseTo(0.6);
    for (const r of Object.values(res)) {
      expect(DecisionResultSchema.parse(r)).toBeTruthy();
      expect(r.latency_ms).toBeGreaterThanOrEqual(0);
    }
  });

  it("truncates long string state to 100000 chars and sends score criteria", async () => {
    const { fetchImpl, calls } = mockFetch(json({ answers: { step_reason_captured: { score: 1 } } }));
    await decide("step_reason_captured", "x".repeat(150_000), { fetchImpl });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.state).toHaveLength(100_000);
    expect(body.questions.step_reason_captured.type).toBe("score");
    expect(body.questions.step_reason_captured.criteria).toHaveLength(3);
  });

  it("normalises choice confidence, noul and score answers", async () => {
    const { fetchImpl } = mockFetch(
      json({
        answers: {
          ask_timing: { choice: "wait", confidence: 0.7, probabilities: { wait: 0.9 } },
          violates_guardrail: { noul: 0.95 },
          step_reason_captured: { score: 2 },
          step_guardrail_captured: { score: 0.5, confidence: 0.9 },
        },
      }),
    );
    const res = await decideMany(
      ["ask_timing", "violates_guardrail", "step_reason_captured", "step_guardrail_captured"],
      {},
      { fetchImpl },
    );
    expect(res.ask_timing).toMatchObject({ answer: "wait", confidence: 0.7 });
    expect(res.violates_guardrail.answer).toBe(0.95);
    expect(res.violates_guardrail.confidence).toBeCloseTo(0.9);
    expect(res.step_reason_captured).toMatchObject({ answer: 1, confidence: 0.5 });
    expect(res.step_guardrail_captured).toMatchObject({ answer: 0.5, confidence: 0.9 });
  });

  it("uses 0.5 confidence for a choice without confidence or probabilities, and halves score 1 of 0..2", async () => {
    const { fetchImpl } = mockFetch(
      json({ answers: { event_class: { choice: "routine" }, step_reason_captured: { score: 1.5 } } }),
    );
    const res = await decideMany(["event_class", "step_reason_captured"], {}, { fetchImpl });
    expect(res.event_class).toMatchObject({ answer: "routine", confidence: 0.5 });
    expect(res.step_reason_captured.answer).toBe(0.75);
  });

  it("retries once after 429", async () => {
    const { fetchImpl, calls } = mockFetch(json({}, 429), json({ answers: { screen_explains_it: { noul: 0.6 } } }));
    const res = await decide("screen_explains_it", {}, { fetchImpl });
    expect(calls).toHaveLength(2);
    expect(res).toMatchObject({ provider: "jev", answer: 0.6 });
  });

  it("does not retry a second time and falls through to heuristic", async () => {
    const { fetchImpl, calls } = mockFetch(json({}, 429), json({}, 429), json({}, 200));
    const res = await decide("screen_explains_it", {}, { fetchImpl });
    expect(calls).toHaveLength(2);
    expect(res.provider).toBe("heuristic");
  });

  it("does not retry on 500", async () => {
    const { fetchImpl, calls } = mockFetch(json({}, 500));
    const res = await decide("screen_explains_it", {}, { fetchImpl });
    expect(calls).toHaveLength(1);
    expect(res.provider).toBe("heuristic");
  });
});

describe("fallthrough chain", () => {
  it("Jev failure falls through to LLM", async () => {
    vi.stubEnv("JEV_API_KEY", "jev-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "ant-test");
    const { fetchImpl, calls } = mockFetch(
      json({}, 500),
      llmReply({ event_class: { answer: "Possible_Guardrail", confidence: 0.85 } }),
    );
    const res = await decide("event_class", {}, { fetchImpl });
    expect(calls.map((c) => c.url)).toEqual([JEV_URL, LLM_URL]);
    expect(res).toMatchObject({ provider: "llm", answer: "possible_guardrail", confidence: 0.85 });
  });

  it("LLM request uses json_schema output with strict objects", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "ant-test");
    const { fetchImpl, calls } = mockFetch(
      llmReply({
        event_class: { answer: "routine", confidence: 0.6 },
        violates_guardrail: { answer: 1.4, confidence: -1 },
      }),
    );
    const res = await decideMany(["event_class", "violates_guardrail"], { a: 1 }, { fetchImpl });
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("ant-test");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.model).toBe("claude-haiku-4-5-20251001");
    expect(body.max_tokens).toBe(400);
    expect(body.output_config.format.type).toBe("json_schema");
    const schema = body.output_config.format.schema;
    expect(schema.additionalProperties).toBe(false);
    expect(schema.required).toEqual(["event_class", "violates_guardrail"]);
    expect(schema.properties.event_class.additionalProperties).toBe(false);
    expect(schema.properties.event_class.required).toEqual(["answer", "confidence"]);
    expect(schema.properties.event_class.properties.answer.enum).toEqual(["routine", "judgment_call", "possible_guardrail"]);
    expect(schema.properties.violates_guardrail.properties.answer).toEqual({ type: "number" });
    expect(JSON.stringify(schema)).not.toMatch(/minimum|maximum/);
    expect(res.violates_guardrail).toMatchObject({ provider: "llm", answer: 1, confidence: 0 });
  });

  it("LLM failure falls through to heuristic", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "ant-test");
    const { fetchImpl } = mockFetch(json({ stop_reason: "refusal", content: [] }));
    const res = await decide("violates_guardrail", overLimitState, { fetchImpl });
    expect(res).toMatchObject({ provider: "heuristic", confidence: 0.4 });
  });

  it("no keys gives heuristic without any fetch", async () => {
    const { fetchImpl, calls } = mockFetch();
    const res = await decide("screen_explains_it", {}, { fetchImpl });
    expect(calls).toHaveLength(0);
    expect(res).toMatchObject({ provider: "heuristic", answer: 0.3, confidence: 0.4 });
  });

  it("never throws: all providers failing returns a heuristic result", async () => {
    vi.stubEnv("JEV_API_KEY", "jev-test");
    vi.stubEnv("ANTHROPIC_API_KEY", "ant-test");
    const { fetchImpl } = mockFetch(new Error("network down"), new Error("network down"));
    const res = await decide("violates_guardrail", overLimitState, { fetchImpl });
    expect(res.provider).toBe("heuristic");
    expect(DecisionResultSchema.parse(res)).toBeTruthy();
  });

  it("DECIDE_PROVIDER forces a provider", async () => {
    vi.stubEnv("JEV_API_KEY", "jev-test");
    vi.stubEnv("DECIDE_PROVIDER", "heuristic");
    const { fetchImpl, calls } = mockFetch();
    const res = await decide("screen_explains_it", {}, { fetchImpl });
    expect(calls).toHaveLength(0);
    expect(res.provider).toBe("heuristic");
  });
});

describe("heuristic", () => {
  const h = (q: Parameters<typeof decide>[0], state: unknown) => decide(q, state, { provider: "heuristic" });

  it.each([
    [{ event: { type: "field_changed", field: "revenue_growth", from: "12%", to: "15%" } }, "judgment_call"],
    [{ event: { type: "button_clicked", field: "Hold" } }, "possible_guardrail"],
    [{ event: { type: "button_clicked", field: "flag" } }, "possible_guardrail"],
    [{ event: { type: "button_clicked", to: "Send for 2nd approval" } }, "possible_guardrail"],
    [{ event: { type: "button_clicked", field: "bold" } }, "routine"],
    [{ event: { type: "status_changed" } }, "possible_guardrail"],
    [{ event: { type: "item_deleted", entity: { kind: "slide", id: "4" } } }, "judgment_call"],
    [{ event: { type: "field_changed", field: "title", to: "Board update" } }, "routine"],
    [{ event: { type: "record_opened" } }, "routine"],
    [{ event: { type: "navigated", entity: { kind: "slide", id: "4" } } }, "routine"],
    [{ event: { type: "app_switched", entity: { kind: "app", id: "Microsoft Outlook" } } }, "routine"],
    [{ event: { type: "text_entered", field: "body" } }, "routine"],
    [{ event: { type: "item_created", entity: { kind: "slide", id: "9" } } }, "routine"],
  ])("event_class %j -> %s", async (state, expected) => {
    expect((await h("event_class", state)).answer).toBe(expected);
  });

  it("an email forwarded to a controller is a judgment call; the same recipient again is routine", async () => {
    const forward = { type: "item_sent", entity: { kind: "email", id: "Offer Q3" }, field: "forward", to: "controller@example.com" };
    expect((await h("event_class", { event: forward })).answer).toBe("judgment_call");
    const prior = [{ ...forward, to: "team@example.com" }];
    expect((await h("event_class", { event: forward, previous_events: prior })).answer).toBe("judgment_call");
    const same = [{ ...forward }];
    expect((await h("event_class", { event: forward, previous_events: same })).answer).toBe("routine");
    // Recipient names are never matched: a different name to the same address is still routine.
    const renamed = { ...forward, to: "CONTROLLER@example.com " };
    expect((await h("event_class", { event: renamed, previous_events: same })).answer).toBe("routine");
  });

  it("no domain-specific wording or rule is left in the prompts and heuristics", () => {
    const files = [
      "src/lib/perception/vision.ts",
      "src/lib/decide/prompts.ts",
      "src/lib/decide/heuristic.ts",
      "src/lib/decide/llm.ts",
      "src/lib/decide/jev.ts",
      "src/lib/voice/prompts.ts",
      "src/lib/workmap/synthesize.ts",
      "src/lib/workmap/score.ts",
      "src/lib/workmap/teachback.ts",
      "src/lib/workmap/export.ts",
    ];
    // Allowlist: the permitted email and slide examples (none of them use a banned word today).
    const allow: RegExp[] = [];
    for (const f of files) {
      const text = allow.reduce((t, re) => t.replace(re, ""), readFileSync(join(process.cwd(), f), "utf8"));
      expect({ f, hit: text.match(/invoice|rechnung|cost.?cent(er|re)|iban|supplier/i)?.[0] ?? null }).toEqual({ f, hit: null });
    }
  });

  it.each([
    [{ typing: true, silence_ms: 5000 }, "wait"],
    [{ typing: false, silence_ms: 800 }, "wait"],
    [{ typing: false, silence_ms: 4000, questions_asked_last_10min: 5 }, "save_for_debrief"],
    [{ typing: false, silence_ms: 4000, questions_asked_last_10min: 2 }, "ask_now"],
  ])("ask_timing %j -> %s", async (state, expected) => {
    expect((await h("ask_timing", state)).answer).toBe(expected);
  });

  it("screen_explains_it is 0.3 and step scores follow reason and guardrails", async () => {
    expect((await h("screen_explains_it", {})).answer).toBe(0.3);
    const full = { step: { reason: { quote: "always 0400 for machines" }, guardrails: [{ rule: "x" }] } };
    const empty = { step: { reason: null, guardrails: [] } };
    expect((await h("step_reason_captured", full)).answer).toBe(1);
    expect((await h("step_guardrail_captured", full)).answer).toBe(1);
    expect((await h("step_reason_captured", empty)).answer).toBe(0);
    expect((await h("step_guardrail_captured", empty)).answer).toBe(0);
  });

  it("a pending value over the stated limit violates the guardrail", async () => {
    const res = await h("violates_guardrail", overLimitState);
    expect(res.answer as number).toBeGreaterThanOrEqual(0.8);
    expect(res).toMatchObject({ provider: "heuristic", confidence: 0.4 });
  });

  it("a delete under a stop-and-ask rule is risky; values under the limit and empty state are not", async () => {
    const del = { pending: { type: "item_deleted" }, guardrails: [{ kind: "stop_and_ask" }] };
    expect((await h("violates_guardrail", del)).answer).toBe(0.6);
    expect((await h("violates_guardrail", { pending: { type: "item_deleted" }, guardrails: [] })).answer).toBe(0.1);
    expect((await h("violates_guardrail", { pending: { value: 900, limit: 5000 } })).answer).toBe(0.1);
    expect((await h("violates_guardrail", { pending: { value: 9000 } })).answer).toBe(0.1);
    expect((await h("violates_guardrail", undefined)).answer).toBe(0.1);
  });
});

describe("POST /api/decide", () => {
  const req = (body: unknown) =>
    new Request("http://localhost/api/decide", { method: "POST", body: JSON.stringify(body) });

  it("returns 400 for an unknown question name", async () => {
    const res = await POST(req({ question: "is_it_friday", state: {} }));
    expect(res.status).toBe(400);
    const res2 = await POST(req({ questions: ["event_class", "nope"], state: {} }));
    expect(res2.status).toBe(400);
  });

  it("returns results keyed by question", async () => {
    const res = await POST(req({ questions: ["event_class", "ask_timing"], state: { event: { type: "status_changed" } } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.results.event_class).toMatchObject({ answer: "possible_guardrail", provider: "heuristic" });
    expect(body.results.ask_timing.provider).toBe("heuristic");
  });
});
