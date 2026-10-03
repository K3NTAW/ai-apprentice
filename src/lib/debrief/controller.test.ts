import { describe, expect, it, vi } from "vitest";
import { SCORE_THRESHOLD, type QAPair, type ScreenEvent, type WorkMap, type WorkMapStep } from "@/lib/types";
import type { Gap } from "@/lib/workmap";
import { createDebriefController, spokenSeconds, type BuildResult, type DebriefApi } from "./controller";

const step = (n: number, score: number, judgment = true): WorkMapStep => ({
  n,
  title: `Step ${n}`,
  screen_moment: { t: n * 10, entity: `invoice 44${n}0`, field: "cost_center" },
  decision: `Decision ${n}`,
  is_judgment_call: judgment,
  reason: null,
  guardrails: [],
  scores: { reason_captured: score, guardrail_captured: score },
});

const gapsFor = (steps: WorkMapStep[]): Gap[] =>
  steps
    .filter((s) => s.scores.reason_captured < SCORE_THRESHOLD)
    .flatMap((s) => [
      { step_n: s.n, missing: "reason" as const, score: s.scores.reason_captured, suggested_question: `Why step ${s.n}?` },
      {
        step_n: s.n,
        missing: "guardrail" as const,
        score: s.scores.guardrail_captured,
        suggested_question: `Limit on step ${s.n}?`,
      },
    ])
    .sort((a, b) => a.score - b.score);

function build(steps: WorkMapStep[]): BuildResult {
  const workmap: WorkMap = { task: "t", expert: "Sabine", confirmed_by_expert: false, steps, open_questions: [] };
  const gaps = gapsFor(steps);
  return { workmap, gaps, understood: gaps.length === 0, teach_back: "Here is what I learned. Did I get that right?" };
}

/** Each rebuild adds `rise` to every score, starting at `start`. */
function fakeApi(opts: { stepCount?: number; start?: number; rise?: number } = {}) {
  const { stepCount = 3, start = 0.2, rise = 0.1 } = opts;
  let builds = 0;
  const api = {
    buildWorkMap: vi.fn(async () => {
      const score = Math.min(1, start + rise * builds++);
      return build(Array.from({ length: stepCount }, (_, i) => step(i + 1, score)));
    }),
    confirm: vi.fn(async () => undefined),
    postTranscript: vi.fn(async () => undefined),
    postQA: vi.fn(async (qa: QAPair) => qa),
  } satisfies DebriefApi;
  return api;
}

const voice = () => ({ promptTurn: vi.fn(), injectContext: vi.fn() });

async function answerAll(ctrl: ReturnType<typeof createDebriefController>, limit = 20) {
  for (let i = 0; i < limit && ctrl.getState().phase === "asking"; i++) await ctrl.onExpertUtterance(`answer ${i}`);
}

describe("debrief controller", () => {
  it("asks at least 3 follow-ups even when the first rebuild is already understood", async () => {
    const api = fakeApi({ start: 0.9, rise: 0 });
    const v = voice();
    const ctrl = createDebriefController({ api, voice: v, sessionId: "s1", now: () => 0 });
    await ctrl.start();
    expect(ctrl.getState().understood).toBe(true);
    expect(ctrl.getState().phase).toBe("asking");
    await answerAll(ctrl);
    const s = ctrl.getState();
    expect(s.followUpsAsked).toBe(3);
    expect(s.phase).toBe("teach_back");
    expect(s.endReason).toBe("all steps above threshold");
    expect(s.asked.every((q) => /invoice 44\d0/.test(q.text))).toBe(true);
  });

  it("never repeats a question that was asked live", async () => {
    const api = fakeApi({ rise: 0 });
    const events: ScreenEvent[] = [
      { id: "e1", t: 10, source: "dom", type: "field_changed", entity: { kind: "invoice", id: "4410" }, field: "cost_center" },
    ];
    const qa: QAPair[] = [
      { id: "q1", t_question: 11, t_answer: 12, question: "Why step 2?", answer: "x", phase: "capture", about: "reason" },
      { id: "q2", t_question: 11, question: "Something about step 1", event_id: "e1", phase: "capture", about: "reason" },
    ];
    const ctrl = createDebriefController({
      api,
      voice: voice(),
      sessionId: "s1",
      session: { qa, events, transcript: [] },
      maxFollowUps: 10,
      now: () => 0,
    });
    await ctrl.start();
    await answerAll(ctrl);
    const texts = ctrl.getState().asked.map((q) => q.text);
    expect(texts).not.toContain("Why step 2?");
    expect(texts).not.toContain("Why step 1?");
    expect(texts).toContain("Limit on step 1?");
    expect(new Set(texts).size).toBe(texts.length);
    expect(texts.length).toBeGreaterThanOrEqual(3);
  });

  it("tops up with saved-for-debrief events before generic probes", async () => {
    const api = fakeApi({ start: 0.9, rise: 0 });
    const saved: ScreenEvent[] = [
      { id: "e9", t: 5, source: "dom", type: "button_clicked", entity: { kind: "invoice", id: "4517" }, field: "hold" },
    ];
    const ctrl = createDebriefController({ api, voice: voice(), sessionId: "s1", savedForDebrief: saved, now: () => 0 });
    await ctrl.start();
    expect(ctrl.getState().question?.source).toBe("saved");
    expect(ctrl.getState().question?.text).toContain("invoice 4517");
  });

  it("stops at maxFollowUps", async () => {
    const api = fakeApi({ stepCount: 6, rise: 0 });
    const ctrl = createDebriefController({ api, voice: voice(), sessionId: "s1", maxFollowUps: 4, now: () => 0 });
    await ctrl.start();
    await answerAll(ctrl);
    const s = ctrl.getState();
    expect(s.followUpsAsked).toBe(4);
    expect(s.endReason).toBe("question budget reached");
    expect(s.phase).toBe("teach_back");
  });

  it("posts each answer as a debrief QAPair and rebuilds; history grows and scores rise", async () => {
    const api = fakeApi({ start: 0.2, rise: 0.2 });
    const v = voice();
    const ctrl = createDebriefController({ api, voice: v, sessionId: "s1", now: () => 0 });
    await ctrl.start();
    expect(api.buildWorkMap).toHaveBeenCalledTimes(1);
    const first = ctrl.getState().question!;
    expect(v.promptTurn).toHaveBeenLastCalledWith(expect.stringContaining(first.text));
    await ctrl.onExpertUtterance("Equipment over 5000 is always capex.");
    expect(api.postQA).toHaveBeenCalledTimes(1);
    const qa = api.postQA.mock.calls[0][0];
    expect(qa).toMatchObject({ phase: "debrief", question: first.text, answer: "Equipment over 5000 is always capex." });
    expect(api.buildWorkMap).toHaveBeenCalledTimes(2);
    await answerAll(ctrl);
    const s = ctrl.getState();
    expect(api.postQA).toHaveBeenCalledTimes(s.followUpsAsked);
    expect(api.buildWorkMap).toHaveBeenCalledTimes(s.followUpsAsked + 1);
    expect(s.history.length).toBe(s.followUpsAsked + 1);
    const series = s.history.map((h) => h.steps[0].reason_captured);
    for (let i = 1; i < series.length; i++) expect(series[i]).toBeGreaterThan(series[i - 1]);
    expect(s.endReason).toBe("all steps above threshold");
  });

  it("prompts the teach-back after asking ends; confirmed=true calls confirm(true)", async () => {
    const api = fakeApi({ start: 0.9, rise: 0 });
    const v = voice();
    const ctrl = createDebriefController({ api, voice: v, sessionId: "s1", now: () => 0 });
    await ctrl.start();
    await answerAll(ctrl);
    expect(v.promptTurn).toHaveBeenLastCalledWith(expect.stringContaining("Here is what I learned."));
    expect(spokenSeconds(ctrl.getState().teachBack!)).toBeLessThan(60);
    await ctrl.onTeachBackResult({ confirmed: true });
    expect(api.confirm).toHaveBeenCalledWith("s1", true);
    expect(ctrl.getState().phase).toBe("confirmed");
    expect(ctrl.getState().workmap?.confirmed_by_expert).toBe(true);
  });

  it("a correction calls confirm(false, correction), rebuilds, and a following confirm ends in 'confirmed'", async () => {
    const api = fakeApi({ start: 0.9, rise: 0 });
    const v = voice();
    const ctrl = createDebriefController({ api, voice: v, sessionId: "s1", now: () => 0 });
    await ctrl.start();
    await answerAll(ctrl);
    const builds = api.buildWorkMap.mock.calls.length;
    const qas = api.postQA.mock.calls.length;
    await ctrl.onTeachBackResult({ confirmed: false, correction: "The limit is 5000, not 1000." });
    expect(api.confirm).toHaveBeenCalledWith("s1", false, "The limit is 5000, not 1000.");
    expect(api.buildWorkMap).toHaveBeenCalledTimes(builds + 1);
    expect(api.postQA).toHaveBeenCalledTimes(qas + 1);
    expect(api.postQA.mock.calls.at(-1)![0]).toMatchObject({ phase: "debrief", answer: "The limit is 5000, not 1000." });
    expect(ctrl.getState().phase).toBe("corrected");
    expect(v.promptTurn).toHaveBeenLastCalledWith(expect.stringContaining("Did I get that right?"));
    await ctrl.onTeachBackResult({ confirmed: true });
    expect(api.confirm).toHaveBeenLastCalledWith("s1", true);
    expect(ctrl.getState().phase).toBe("confirmed");
  });

  it("'Not quite' without a correction waits for one", async () => {
    const api = fakeApi({ start: 0.9, rise: 0 });
    const ctrl = createDebriefController({ api, voice: voice(), sessionId: "s1", now: () => 0 });
    await ctrl.start();
    await answerAll(ctrl);
    await ctrl.onTeachBackResult({ confirmed: false });
    expect(api.confirm).not.toHaveBeenCalled();
    expect(ctrl.getState().awaitingCorrection).toBe(true);
    expect(ctrl.getState().phase).toBe("teach_back");
  });
});
