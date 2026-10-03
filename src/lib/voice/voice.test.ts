import { afterEach, describe, expect, it, vi } from "vitest";
import type { DecisionResult, ScreenEvent } from "@/lib/types";
import { createAskGate, type AskGateInput } from "./askGate";
import {
  buildDebriefTurn,
  buildGuardrailStopTurn,
  buildMasteryTurn,
  buildPredictTurn,
  buildScreenEventTurn,
  buildTeachBackTurn,
  describeEvent,
} from "./prompts";
import { GET } from "@/app/api/voice/signed-url/route";

const event: ScreenEvent = {
  id: "e1",
  t: 1000,
  source: "dom",
  type: "field_changed",
  entity: { kind: "invoice", id: "4471" },
  field: "cost_center",
  from: "4711",
  to: "0400",
};

function dr(question: DecisionResult["question"], answer: string | number): DecisionResult {
  return { question, answer, confidence: 0.9, provider: "heuristic", latency_ms: 1 };
}

const quiet = { typing: false, speaking: false, silence_ms: 3000 };

function input(over: Partial<AskGateInput> & { cls?: string; explains?: number } = {}): AskGateInput {
  const { cls = "judgment_call", explains = 0.2, ...rest } = over;
  return {
    event,
    eventClass: dr("event_class", cls),
    screenExplains: dr("screen_explains_it", explains),
    timing: dr("ask_timing", "ask_now"),
    activity: quiet,
    agentSpeaking: false,
    ...rest,
  };
}

function clock(start = 0) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe("askGate", () => {
  it("waits while the expert is typing", () => {
    const g = createAskGate({ now: () => 0 });
    expect(g.consider(input({ activity: { ...quiet, typing: true } })).action).toBe("wait");
  });

  it("waits while the expert is speaking", () => {
    const g = createAskGate({ now: () => 0 });
    expect(g.consider(input({ activity: { ...quiet, speaking: true } })).action).toBe("wait");
  });

  it("waits while the agent is speaking or the pause is under 1500 ms", () => {
    const g = createAskGate({ now: () => 0 });
    expect(g.consider(input({ agentSpeaking: true })).action).toBe("wait");
    expect(g.consider(input({ activity: { ...quiet, silence_ms: 1499 } })).action).toBe("wait");
    expect(g.consider(input({ cls: "possible_guardrail", activity: { ...quiet, silence_ms: 200 } })).action).toBe("wait");
  });

  it("asks a reason question after a 3000 ms pause on a judgment call", () => {
    const g = createAskGate({ now: () => 0 });
    expect(g.consider(input())).toMatchObject({ action: "ask_now", ask: "reason" });
  });

  it("asks a guardrail question on a possible guardrail", () => {
    const g = createAskGate({ now: () => 0 });
    expect(g.consider(input({ cls: "possible_guardrail" }))).toMatchObject({ action: "ask_now", ask: "guardrail" });
  });

  it("saves the sixth question within 10 minutes for the debrief", () => {
    const c = clock();
    const g = createAskGate({ now: c.now });
    for (let i = 0; i < 5; i++) {
      const d = g.consider(input({ cls: "possible_guardrail" }));
      expect(d.action).toBe("ask_now");
      g.markAsked(d.ask!);
      c.advance(60_000);
    }
    expect(g.consider(input({ cls: "possible_guardrail" }))).toMatchObject({ action: "save_for_debrief", why: "budget" });
    c.advance(6 * 60_000);
    expect(g.consider(input({ cls: "possible_guardrail" })).action).toBe("ask_now");
  });

  it("respects the minimum gap between questions", () => {
    const c = clock();
    const g = createAskGate({ now: c.now });
    g.markAsked("reason");
    c.advance(19_999);
    expect(g.consider(input())).toMatchObject({ action: "save_for_debrief", why: "min_gap" });
    c.advance(1);
    expect(g.consider(input()).action).toBe("ask_now");
  });

  it("forces a guardrail question after 3 reason questions", () => {
    const c = clock();
    const g = createAskGate({ now: c.now });
    for (let i = 0; i < 3; i++) {
      const d = g.consider(input());
      expect(d).toMatchObject({ action: "ask_now", ask: "reason" });
      g.markAsked(d.ask!);
      c.advance(30_000);
    }
    expect(g.consider(input())).toMatchObject({ action: "ask_now", ask: "guardrail" });
    g.markAsked("guardrail");
    c.advance(30_000);
    expect(g.consider(input())).toMatchObject({ action: "ask_now", ask: "reason" });
  });

  it("does not ask about routine events", () => {
    const g = createAskGate({ now: () => 0 });
    expect(g.consider(input({ cls: "routine" }))).toEqual({ action: "wait", why: "routine" });
    expect(g.consider(input({ explains: 0.8 }))).toMatchObject({ action: "save_for_debrief" });
  });

  it("retries pending events once the expert pauses", () => {
    const g = createAskGate({ now: () => 0 });
    const item = input({ activity: { ...quiet, typing: true } });
    expect(g.consider(item).action).toBe("wait");
    g.enqueue(item);
    expect(g.nextReady({ ...quiet, typing: true })).toBeNull();
    expect(g.stats().pending).toBe(1);
    const ready = g.nextReady(quiet);
    expect(ready?.decision).toMatchObject({ action: "ask_now", ask: "reason" });
    expect(g.stats().pending).toBe(0);
  });
});

describe("message builders", () => {
  it("describes an event in one plain sentence", () => {
    expect(describeEvent(event)).toBe("cost center of invoice 4471 changed from 4711 to 0400");
  });

  it("carries the tags and names the on-screen object", () => {
    const screen = buildScreenEventTurn(event, "reason");
    expect(screen.startsWith("[SCREEN_EVENT]")).toBe(true);
    expect(screen).toContain("invoice 4471");
    expect(screen).toContain("cost center");
    expect(buildScreenEventTurn(event, "guardrail")).toMatch(/stop and ask someone/);
    expect(buildDebriefTurn(["Why 0400?", "Any limit?"])).toMatch(/^\[DEBRIEF\][\s\S]*1\. Why 0400\?\n2\. Any limit\?/);
    expect(buildTeachBackTurn("You move it to 0400.")).toBe("[TEACH_BACK] You move it to 0400.");
    const step = {
      n: 2,
      title: "Fix the cost center",
      screen_moment: { t: 1000, entity: "invoice 4471", field: "cost_center" },
      guardrails: [{ rule: "Above 10k ask finance", quote_ref: 1, kind: "limit" as const, quote: "over ten grand I call Anna" }],
    };
    const predict = buildPredictTurn(step);
    expect(predict.startsWith("[PREDICT]")).toBe(true);
    expect(predict).toContain("invoice 4471");
    const stop = buildGuardrailStopTurn({ expert: "Marta", step, pending: "approve invoice 4471" });
    expect(stop.startsWith("[GUARDRAIL_STOP]")).toBe(true);
    expect(stop).toContain("Marta would stop here. Why do you think?");
    expect(stop).toContain("over ten grand I call Anna");
    expect(stop).toContain('"step_n": 2');
    expect(buildMasteryTurn("You got 4 of 5.")).toBe("[MASTERY] You got 4 of 5.");
  });
});

describe("GET /api/voice/signed-url", () => {
  const KEY = "sk_test_secret_value";
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("returns 400 for an unknown role", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    const res = await GET(new Request("http://x/api/voice/signed-url?role=boss"));
    expect(res.status).toBe(400);
    expect(await res.text()).not.toContain(KEY);
  });

  it("returns 503 with the missing env names", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    vi.stubEnv("ELEVENLABS_AGENT_ID_TUTOR", "");
    const res = await GET(new Request("http://x/api/voice/signed-url?role=tutor"));
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: "missing_env",
      missing: ["ELEVENLABS_API_KEY", "ELEVENLABS_AGENT_ID_TUTOR"],
    });
  });

  it("returns only the signed url and never the key", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", KEY);
    vi.stubEnv("ELEVENLABS_AGENT_ID_INTERVIEWER", "agent_123");
    const fetchMock = vi.fn(async () => Response.json({ signed_url: "wss://example/signed" }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await GET(new Request("http://x/api/voice/signed-url?role=interviewer"));
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ signed_url: "wss://example/signed" });
    expect(text).not.toContain(KEY);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("agent_id=agent_123");
    expect((init.headers as Record<string, string>)["xi-api-key"]).toBe(KEY);
  });
});
