// T-0240: unprompted narration is linked to nearby events and used as a reason in synthesis; the debrief skips it.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { QAPair, ScreenEvent, Session, TranscriptEntry, WorkMap } from "@/lib/types";
import { explainedEvents, isExplanation, linkNarration, MAX_LINKS, narrationsOf } from "@/lib/capture/narration";
import { createDebriefController, type DebriefApi } from "@/lib/debrief/controller";
import { fallbackWorkMap, synthesizeWorkMap } from "./synthesize";

const ev = (id: string, t: number, over: Partial<ScreenEvent> = {}): ScreenEvent => ({
  id,
  t,
  source: "os",
  type: "field_changed",
  app: "Excel",
  entity: { kind: "invoice", id },
  field: "cost_center",
  from: "4711",
  to: "0400",
  ...over,
});
const said = (t: number, text: string, phase: TranscriptEntry["phase"] = "capture"): TranscriptEntry => ({
  id: `tr_${t}`,
  t,
  speaker: "expert",
  text,
  phase,
  redacted: true,
});
const NARRATION = "I always move equipment to 0400 because 4711 is closed for capex.";

function session(over: Partial<Session> = {}): Session {
  return {
    id: "s1",
    kind: "capture",
    started_at: "2026-10-04T10:00:00Z",
    expert: "Sabine",
    events: [ev("4471", 10), ev("5005", 60)],
    transcript: [said(14, NARRATION)],
    qa: [],
    off_record_ranges: [],
    ...over,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("narration linking", () => {
  it("links to the nearest events within the window, ties to the earlier one, at most MAX_LINKS", () => {
    const events = [ev("a", 0), ev("b", 8), ev("c", 12), ev("d", 9), ev("e", 11), ev("far", 40)];
    expect(linkNarration(10, events)).toEqual(["d", "e", "b"].slice(0, MAX_LINKS));
    expect(linkNarration(10, events)).not.toContain("far");
    expect(linkNarration(100, events)).toEqual([]);
  });

  it("answers to live questions are not narration; only explanations explain events", () => {
    const qa: QAPair = { id: "q", t_question: 58, question: "Why?", answer: "Budget.", t_answer: 61, phase: "capture", about: "reason", event_id: "5005" };
    const s = session({ transcript: [said(14, NARRATION), said(61, "Budget."), said(30, "ok, next one")], qa: [qa] });
    const n = narrationsOf(s);
    expect(n.map((x) => x.t)).toEqual([14, 30]);
    expect(isExplanation("ok, next one")).toBe(false);
    expect([...explainedEvents(n).keys()]).toEqual(["4471"]);
  });
});

describe("narration in Work Map synthesis", () => {
  it("sends narration with its linked events to the model and keeps the narration reason (mocked LLM)", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "test-key");
    const out = {
      task: "Fix cost centers",
      steps: [
        {
          title: "Move invoice 4471 to 0400",
          screen_moment: { t: 10, frame_ref: null, app: "Excel", entity: "invoice 4471", field: "cost_center" },
          decision: "Move invoice 4471 to cost center 0400 in Excel",
          is_judgment_call: true,
          reason: { quote: "4711 is closed for capex", t: 14, source: "narration" },
          guardrails: [],
        },
      ],
      open_questions: [],
    };
    const fetchImpl = vi.fn(async () => Response.json({ stop_reason: "end_turn", content: [{ type: "text", text: JSON.stringify(out) }] })) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    const wm = await synthesizeWorkMap(session(), { fetchImpl });
    const body = JSON.parse(String((fetchImpl.mock.calls[0] as [string, RequestInit])[1].body));
    const payload = JSON.parse(body.messages[0].content.split("<session>\n")[1].split("\n</session>")[0]);
    expect(payload.transcript[0]).toMatchObject({ kind: "narration", linked_events: [{ t: 10, entity: "invoice 4471" }] });
    expect(body.system).toContain('kind "narration"');
    expect(wm.steps[0].reason).toEqual({ quote: "4711 is closed for capex", t: 14, source: "narration" });
  });

  it("fallback (no key): the narration becomes the step's reason and a guardrail", () => {
    const wm = fallbackWorkMap(session());
    const step = wm.steps.find((s) => s.screen_moment.entity === "invoice 4471")!;
    expect(step.reason).toEqual({ quote: NARRATION, t: 14, source: "narration" });
    expect(step.guardrails.map((g) => g.quote)).toContain(NARRATION);
    const other = wm.steps.find((s) => s.screen_moment.entity === "invoice 5005")!;
    expect(other.reason).toBeNull();
  });
});

describe("debrief skips what narration explained", () => {
  it("no saved-event question and no reason gap for the explained event", async () => {
    const s = session();
    const wm: WorkMap = {
      task: "t",
      expert: "Sabine",
      confirmed_by_expert: false,
      open_questions: [],
      steps: [
        { n: 1, title: "a", screen_moment: { t: 10, entity: "invoice 4471" }, decision: "d", is_judgment_call: true, reason: null, guardrails: [], scores: { reason_captured: 0, guardrail_captured: 1 } },
        { n: 2, title: "b", screen_moment: { t: 60, entity: "invoice 5005" }, decision: "d", is_judgment_call: true, reason: null, guardrails: [], scores: { reason_captured: 0, guardrail_captured: 1 } },
      ],
    };
    const api = {
      buildWorkMap: vi.fn(async () => ({
        workmap: wm,
        gaps: [1, 2].map((n) => ({ step_n: n, missing: "reason" as const, score: 0, suggested_question: `Why step ${n}?` })),
        understood: false,
        teach_back: "ok?",
      })),
      confirm: vi.fn(async () => undefined),
      postTranscript: vi.fn(async () => undefined),
      postQA: vi.fn(async (qa: QAPair) => qa),
    } satisfies DebriefApi;
    const ctrl = createDebriefController({
      api,
      voice: { promptTurn: vi.fn(), injectContext: vi.fn() },
      sessionId: "s1",
      session: s,
      savedForDebrief: s.events,
      now: () => 0,
    });
    await ctrl.start();
    const st = ctrl.getState();
    const all = [st.question, ...st.queue].filter(Boolean).map((q) => q!.text);
    expect(all).toContain("Why step 2?");
    expect(all).not.toContain("Why step 1?");
    // Saved events: the explained one is not asked as a reason question, the other one is.
    expect(all.some((t) => t.startsWith("Why this step on invoice 4471"))).toBe(false);
    expect(all.some((t) => t.startsWith("Why this step on invoice 5005"))).toBe(true);
  });
});
