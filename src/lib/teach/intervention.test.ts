import { afterEach, describe, expect, it, vi } from "vitest";
import type { ScreenEvent } from "@/lib/types";
import { EMAIL_FLOW_EVENTS, EMAIL_FLOW_WORKMAP, SLIDE_FLOW_EVENTS, SLIDE_FLOW_WORKMAP } from "./fixtures";
import {
  COOLDOWN_MS,
  DECIDE_MAX_PER_MINUTE,
  DECIDE_RECENT_EVENTS,
  DECIDE_TIMEOUT_MS,
  eventAmount,
  requiredCode,
  NOT_PAIRED_NOTICE,
  createInterventionEngine,
  limitRule,
  parseAmount,
  type Intervention,
  type TeachDecide,
} from "./intervention";
import { matchStep } from "./stepMatch";

function setup(opts: { decide?: TeachDecide; paired?: boolean; workmap?: typeof EMAIL_FLOW_WORKMAP } = {}) {
  let t = 1_000_000;
  const workmap = opts.workmap ?? EMAIL_FLOW_WORKMAP;
  const companion = { showHalo: vi.fn(() => opts.paired ?? true), clearHalo: vi.fn(() => true) };
  const decide = vi.fn(opts.decide ?? (async () => 0.1));
  const fired: Intervention[] = [];
  const cleared: string[] = [];
  const engine = createInterventionEngine({
    workmap,
    decide,
    companion,
    now: () => t,
    onIntervene: (iv) => fired.push(iv),
    onClear: (id, reason) => cleared.push(`${id}:${reason}`),
  });
  const feed = (e: ScreenEvent) => engine.onEvent(e, matchStep(e, workmap));
  return { engine, companion, decide, fired, cleared, feed, tick: (ms: number) => (t += ms) };
}

const [open, amount, wrongCode, rightCode, reply] = EMAIL_FLOW_EVENTS;

describe("guardrail rules", () => {
  it("parses amounts and limit rules; unparseable gives null", () => {
    expect(parseAmount("EUR 7,200")).toBe(7200);
    expect(parseAmount("7'200.50 CHF")).toBe(7200.5);
    expect(parseAmount("15%")).toBe(15);
    expect(parseAmount("about seven thousand")).toBeNull();
    expect(limitRule(EMAIL_FLOW_WORKMAP.steps[2].guardrails[0])).toEqual({ limit: 5000, unit: "money", required: "0400" });
    expect(limitRule(SLIDE_FLOW_WORKMAP.steps[1].guardrails[0])).toEqual({ limit: 10, unit: "percent", required: undefined });
  });
});

describe("intervention engine", () => {
  it("a deterministic limit rule triggers one intervention with the expert, quote and halo", async () => {
    const s = setup();
    for (const e of [open, amount]) await s.feed(e);
    const iv = await s.feed(wrongCode);
    expect(iv).not.toBeNull();
    expect(s.fired).toHaveLength(1);
    expect(iv!.say).toBe("Sabine would stop here. Why do you think?");
    expect(iv!.quote).toBe("Equipment over €5,000 is always capex, so it gets code 0400.");
    expect(iv!.source).toBe("rule");
    expect(iv!.replay).toMatchObject({ t: 48, frame_ref: "frames/sabine-48.jpg" });
    expect(s.companion.showHalo).toHaveBeenCalledWith(iv!.id, wrongCode.rect, expect.stringContaining("Sabine would stop here"));
    expect(s.decide).not.toHaveBeenCalled();
    // The same wrong value again does not stop twice.
    expect(await s.feed({ ...wrongCode, id: "again" })).toBeNull();
    expect(s.fired).toHaveLength(1);
  });

  it("clears the halo when the state changes back, then a compliant change triggers none", async () => {
    const s = setup();
    for (const e of [open, amount, wrongCode]) await s.feed(e);
    const id = s.fired[0].id;
    expect(await s.feed(rightCode)).toBeNull();
    expect(s.companion.clearHalo).toHaveBeenCalledWith(id);
    expect(s.cleared).toEqual([`${id}:resolved`]);
    expect(s.fired).toHaveLength(1);
    expect(s.engine.stats().active).toBe(0);
  });

  it("a compliant amount triggers no stop", async () => {
    const s = setup();
    await s.feed({ ...amount, to: "EUR 1,200" });
    expect(await s.feed(wrongCode)).toBeNull();
    expect(s.fired).toHaveLength(0);
  });

  it("decide above the threshold intervenes when no rule decides (amount not parseable)", async () => {
    const s = setup({ decide: async () => 0.9 });
    await s.feed({ ...amount, to: "seven thousand two hundred" });
    const iv = await s.feed(wrongCode);
    expect(s.decide).toHaveBeenCalledTimes(1);
    expect(s.decide.mock.calls[0][1].guardrails).toEqual(EMAIL_FLOW_WORKMAP.steps[2].guardrails);
    expect(iv).toMatchObject({ source: "decide", probability: 0.9, expert: "Sabine" });
    expect(s.companion.showHalo).toHaveBeenCalledWith(iv!.id, wrongCode.rect, expect.any(String));
  });

  it("decide below the threshold, failing or timing out never intervenes; failures are counted", async () => {
    const low = setup({ decide: async () => 0.2 });
    expect(await low.feed(wrongCode)).toBeNull();
    const failing = setup({ decide: async () => Promise.reject(new Error("decide 500")) });
    expect(await failing.feed(wrongCode)).toBeNull();
    expect(failing.engine.stats()).toMatchObject({ decideFailures: 1, lastDecideError: "decide 500", capped: false });
    const capped = setup({ decide: async () => Promise.reject(new Error("decide 429")) });
    await capped.feed(wrongCode);
    capped.tick(5000);
    await capped.feed({ ...wrongCode, to: "4712" });
    expect(capped.decide).toHaveBeenCalledTimes(1);
    expect(capped.engine.stats().capped).toBe(true);
  });

  it("dedupes decide by step, field and value and caps calls per minute", async () => {
    const s = setup({ decide: async () => 0.1 });
    await s.feed(wrongCode);
    s.tick(2000);
    await s.feed({ ...wrongCode, id: "dup" });
    expect(s.decide).toHaveBeenCalledTimes(1);
    for (let i = 0; i < DECIDE_MAX_PER_MINUTE + 3; i++) {
      s.tick(1500);
      await s.feed({ ...wrongCode, to: `47${i}0` });
    }
    expect(s.decide).toHaveBeenCalledTimes(DECIDE_MAX_PER_MINUTE);
  });

  it("clears on move-on and on end; cooldown holds the same value back", async () => {
    const s = setup();
    for (const e of [amount, wrongCode]) await s.feed(e);
    await s.feed(reply);
    expect(s.cleared[0]).toMatch(/:moved_on$/);
    expect(await s.feed({ ...wrongCode, id: "back" })).toBeNull();
    s.tick(COOLDOWN_MS + 1);
    expect(await s.feed({ ...wrongCode, id: "later" })).not.toBeNull();
    s.engine.clearAll("end");
    expect(s.cleared[1]).toMatch(/:end$/);
  });

  it("intervenes by voice only with a notice when the companion is not paired", async () => {
    const s = setup({ paired: false });
    for (const e of [amount, wrongCode]) await s.feed(e);
    expect(s.fired[0]).toMatchObject({ halo: false, notice: NOT_PAIRED_NOTICE });
  });

  it("slide flow: a discount over the limit stops, the title does not", async () => {
    const s = setup({ workmap: SLIDE_FLOW_WORKMAP });
    expect(await s.feed(SLIDE_FLOW_EVENTS[0])).toBeNull();
    expect(await s.feed(SLIDE_FLOW_EVENTS[1])).toMatchObject({ expert: "Marco", source: "rule" });
  });
});

describe("Teach stop fixes (P0-3)", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("parses the required code from 'coded 0400', 'capex (0400)', 'to 0400' and a lone '0400'", () => {
    for (const rule of [
      "Equipment over 5,000 EUR must be coded 0400",
      "Equipment over 5,000 EUR is capex (0400)",
      "Equipment over 5,000 EUR goes to 0400",
      "Equipment over 5,000 EUR must be booked as capex 0400",
      "Equipment over 5,000 EUR: 0400",
      "Cost center 0400 for equipment over 5'000 CHF",
    ])
      expect(requiredCode(rule)).toBe("0400");
    expect(requiredCode("Discount over 10% needs approval")).toBeUndefined();
    expect(requiredCode("Over 5,000 EUR stop and ask")).toBeUndefined();
  });

  it("reads the case amount from any amount label, defensively", () => {
    const base = { id: "x", t: 1, source: "vision" as const, type: "record_opened" as const, entity: { kind: "record", id: "PR-7" } };
    expect(eventAmount({ ...base, field: "Total (EUR)", to: "7,200" })).toBe(7200);
    expect(eventAmount({ ...base, amount: "EUR 7,200" } as never)).toBe(7200);
    expect(eventAmount({ ...base, amount: 7200 } as never)).toBe(7200);
    expect(eventAmount({ ...base, labels: { Supplier: "ACME", Amount: "7'200.00" } } as never)).toBe(7200);
    expect(eventAmount({ ...base, label: "Amount", value: "7,200" } as never)).toBe(7200);
    expect(eventAmount({ ...base, amount: "n/a", labels: ["x"], label: 3 } as never)).toBeNull();
    expect(eventAmount({ ...base, field: "subject", to: "Order 4711" })).toBeNull();
  });

  it("opening a 7,200 record and setting cost center 4711 stops deterministically with no network call", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const step = EMAIL_FLOW_WORKMAP.steps[2];
    const workmap = {
      ...EMAIL_FLOW_WORKMAP,
      steps: EMAIL_FLOW_WORKMAP.steps.map((x) =>
        x.n === step.n
          ? {
              ...x,
              screen_moment: { ...x.screen_moment, entity: "purchase record", field: "cost center" },
              guardrails: [{ ...x.guardrails[0], rule: "Equipment over 5,000 EUR is capex (0400)" }],
            }
          : x,
      ),
    };
    const s = setup({ workmap, decide: async () => 0.9 });
    const opened: ScreenEvent = {
      id: "r1",
      t: 1,
      source: "vision",
      type: "record_opened",
      app: "Microsoft Excel",
      entity: { kind: "purchase record", id: "PR-7" },
      amount: "EUR 7,200",
    } as ScreenEvent;
    await s.feed(opened);
    const iv = await s.feed({
      id: "r2",
      t: 5,
      source: "vision",
      type: "field_changed",
      app: "Microsoft Excel",
      entity: { kind: "purchase record", id: "PR-7" },
      field: "cost center",
      from: "",
      to: "4711",
    });
    expect(iv).not.toBeNull();
    expect(iv!.source).toBe("rule");
    expect(iv!.pending).toMatchObject({ amount: 7200, to: "4711" });
    expect(s.decide).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("decide waits 6 s and gets the last 8 events, oldest first", async () => {
    expect(DECIDE_TIMEOUT_MS).toBe(6000);
    expect(DECIDE_RECENT_EVENTS).toBe(8);
    vi.useFakeTimers();
    try {
      const s = setup({ decide: () => new Promise<number>(() => {}) });
      const filler = Array.from({ length: 10 }, (_, i): ScreenEvent => ({ ...open, id: `f${i}`, t: i }));
      for (const e of filler) await s.feed(e);
      await s.feed({ ...amount, to: "seven thousand two hundred" });
      const asked = s.feed(wrongCode);
      await vi.advanceTimersByTimeAsync(0);
      expect(s.decide).toHaveBeenCalledTimes(1);
      const recent = s.decide.mock.calls[0][1].recent;
      expect(recent.map((e) => e.id)).toEqual(["f3", "f4", "f5", "f6", "f7", "f8", "f9", amount.id, wrongCode.id].slice(-8));
      await vi.advanceTimersByTimeAsync(5999);
      expect(s.engine.stats().decideFailures).toBe(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(await asked).toBeNull();
      expect(s.engine.stats()).toMatchObject({ decideFailures: 1, lastDecideError: "decide timeout" });
    } finally {
      vi.useRealTimers();
    }
  });
});
