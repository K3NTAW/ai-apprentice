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
  INTERVIEWER_PROMPT,
  TUTOR_PROMPT,
} from "./prompts";
import { GET } from "@/app/api/voice/signed-url/route";

const event: ScreenEvent = {
  id: "e1",
  t: 1000,
  source: "dom",
  type: "field_changed",
  entity: { kind: "slide", id: "2" },
  field: "revenue_growth",
  from: "12%",
  to: "15%",
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
    expect(describeEvent(event)).toBe("revenue growth of slide 2 changed from 12% to 15%");
    expect(describeEvent({ ...event, app: "Microsoft PowerPoint" })).toBe(
      "revenue growth of slide 2 changed from 12% to 15% in Microsoft PowerPoint",
    );
  });

  it("describes every event type in a non-empty sentence", () => {
    const mail = { ...event, entity: { kind: "email", id: "Offer Q3" }, app: "Microsoft Outlook", field: undefined, from: undefined, to: undefined };
    const cases: [ScreenEvent, string][] = [
      [{ ...mail, type: "record_opened" }, "email Offer Q3 opened in Microsoft Outlook"],
      [{ ...mail, type: "button_clicked", field: "flag" }, "flag clicked on email Offer Q3 in Microsoft Outlook"],
      [{ ...mail, type: "status_changed", to: "flagged" }, "status of email Offer Q3 set to flagged in Microsoft Outlook"],
      [{ ...mail, type: "app_switched", window: "Inbox" }, "switched to Microsoft Outlook (Inbox)"],
      [{ ...mail, type: "text_entered", field: "body" }, "body typed in email Offer Q3 in Microsoft Outlook"],
      [{ ...mail, type: "item_created", entity: { kind: "slide", id: "9" }, app: undefined }, "slide 9 created"],
      [{ ...mail, type: "item_sent", field: "forward", to: "controller" }, "email Offer Q3 sent (forward) to controller in Microsoft Outlook"],
      [{ ...mail, type: "item_deleted", entity: { kind: "slide", id: "4" }, app: "Microsoft PowerPoint" }, "slide 4 deleted in Microsoft PowerPoint"],
      [{ ...mail, type: "navigated", entity: { kind: "folder", id: "Archive" } }, "moved to folder Archive in Microsoft Outlook"],
      [{ ...mail, type: "field_changed", field: "subject", to: "Offer Q4" }, "subject of email Offer Q3 set to Offer Q4 in Microsoft Outlook"],
    ];
    expect(new Set(cases.map(([e]) => e.type)).size).toBe(10);
    for (const [e, text] of cases) expect(describeEvent(e)).toBe(text);
  });

  it("the agent prompts carry no domain-specific wording", () => {
    for (const p of [INTERVIEWER_PROMPT, TUTOR_PROMPT]) {
      expect(p).not.toMatch(/invoice|rechnung|cost.?cent(er|re)|iban|supplier/i);
    }
    expect(INTERVIEWER_PROMPT).toContain("slide 4");
  });

  it("carries the tags and names the on-screen object", () => {
    const screen = buildScreenEventTurn(event, "reason");
    expect(screen.startsWith("[SCREEN_EVENT]")).toBe(true);
    expect(screen).toContain("slide 2");
    expect(screen).toContain("revenue growth");
    expect(buildScreenEventTurn(event, "guardrail")).toMatch(/stop and ask someone/);
    expect(buildDebriefTurn(["Why 15%?", "Any limit?"])).toMatch(/^\[DEBRIEF\][\s\S]*1\. Why 15%\?\n2\. Any limit\?/);
    expect(buildTeachBackTurn("You set it to 15%.")).toBe("[TEACH_BACK] You set it to 15%.");
    const step = {
      n: 2,
      title: "Update the growth figure",
      screen_moment: { t: 1000, app: "Microsoft PowerPoint", entity: "slide 2", field: "revenue_growth" },
      guardrails: [{ rule: "Above 5 points ask the CFO", quote_ref: 1, kind: "limit" as const, quote: "over five points I call Anna" }],
    };
    const predict = buildPredictTurn(step);
    expect(predict.startsWith("[PREDICT]")).toBe(true);
    expect(predict).toContain("slide 2");
    const stop = buildGuardrailStopTurn({ expert: "Marta", step, pending: "send the deck" });
    expect(stop.startsWith("[GUARDRAIL_STOP]")).toBe(true);
    expect(stop).toContain("Marta would stop here. Why do you think?");
    expect(stop).toContain("over five points I call Anna");
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
