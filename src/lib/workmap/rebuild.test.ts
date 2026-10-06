import { describe, expect, it, vi } from "vitest";
import type { Session, WorkMap } from "@/lib/types";
import type { ModelUsage } from "@/lib/perception/vision";
import { rebuildWorkMap } from "./rebuild";
import type { SynthesizeOptions } from "./synthesize";

const map = (task: string): WorkMap => ({ task, expert: "Sabine", confirmed_by_expert: false, steps: [], open_questions: [] });
const session = (workmap?: WorkMap) => ({ id: "s1", workmap }) as unknown as Session;
const scored = (m: WorkMap) => ({ ...m, task: `${m.task} (scored)` });

describe("rebuildWorkMap", () => {
  it("rescore only skips synthesis and rescores the saved map", async () => {
    const synthesize = vi.fn(async () => map("new"));
    const score = vi.fn(async (m: WorkMap) => scored(m));
    const res = await rebuildWorkMap(session(map("last")), { rescoreOnly: true, synthesize, score });
    expect(synthesize).not.toHaveBeenCalled();
    expect(res).toEqual({ workmap: scored(map("last")), mode: "rescore" });
  });

  it("a full rebuild synthesizes and scores", async () => {
    const synthesize = vi.fn(async () => map("new"));
    const score = vi.fn(async (m: WorkMap) => scored(m));
    const res = await rebuildWorkMap(session(map("last")), { synthesize, score });
    expect(res).toEqual({ workmap: scored(map("new")), mode: "full" });
  });

  it("falls back to the last map plus the new answers when synthesis runs past its budget", async () => {
    const synthesize = vi.fn(() => new Promise<WorkMap>((res) => setTimeout(() => res(map("late")), 1000)));
    const s = session(map("last"));
    const score = vi.fn(async (m: WorkMap, _s: Session) => scored(m));
    const res = await rebuildWorkMap(s, { synthesize, score, timeoutMs: 10 });
    expect(res).toEqual({ workmap: scored(map("last")), mode: "fallback" });
    // Rescored against the session, which holds the new answers.
    expect(score).toHaveBeenCalledWith(map("last"), s);
  });

  it("falls back to the last map when synthesis throws", async () => {
    const synthesize = vi.fn(async () => {
      throw new Error("boom");
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await rebuildWorkMap(session(map("last")), { synthesize, score: async (m) => m, timeoutMs: 10 });
    expect(res.mode).toBe("fallback");
    expect(res.workmap.task).toBe("last");
    warn.mockRestore();
  });

  it("without a saved map there is nothing to fall back to, so it waits for synthesis", async () => {
    const synthesize = vi.fn(async () => map("new"));
    const res = await rebuildWorkMap(session(), { rescoreOnly: true, synthesize, score: async (m) => m, timeoutMs: 1 });
    expect(res).toEqual({ workmap: map("new"), mode: "full" });
  });
});

describe("rebuildWorkMap usage", () => {
  const usage: ModelUsage = { model: "claude-opus-5-5", input_tokens: 9000, output_tokens: 1200, cache_read_tokens: 0 };
  // A synthesize that reports usage like synthesizeWorkMap does: once, when the model answered, after delayMs.
  const billing = (task: string, delayMs = 0) =>
    vi.fn(
      (_s: Session, o?: SynthesizeOptions) =>
        new Promise<WorkMap>((res) =>
          setTimeout(() => {
            o?.onUsage?.(usage);
            res(map(task));
          }, delayMs),
        ),
    );
  const score = async (m: WorkMap) => m;

  it("injected synthesize receives onUsage", async () => {
    const synthesize = billing("new");
    await rebuildWorkMap(session(), { synthesize, score, onUsage: vi.fn() });
    expect(synthesize.mock.calls[0][1]?.onUsage).toBeTypeOf("function");
  });

  it("first build records once", async () => {
    const onUsage = vi.fn();
    const res = await rebuildWorkMap(session(), { synthesize: billing("new"), score, onUsage });
    expect(res.mode).toBe("full");
    expect(onUsage).toHaveBeenCalledTimes(1);
    expect(onUsage).toHaveBeenCalledWith(usage);
  });

  it("raced rebuild records once", async () => {
    const onUsage = vi.fn();
    const res = await rebuildWorkMap(session(map("last")), { synthesize: billing("new"), score, onUsage, timeoutMs: 1000 });
    expect(res.mode).toBe("full");
    expect(onUsage).toHaveBeenCalledTimes(1);
  });

  it("race timeout records nothing, even when the late call answers", async () => {
    const onUsage = vi.fn();
    const res = await rebuildWorkMap(session(map("last")), { synthesize: billing("late", 50), score, onUsage, timeoutMs: 5 });
    expect(res.mode).toBe("fallback");
    await new Promise((r) => setTimeout(r, 80));
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("rescore only records nothing", async () => {
    const onUsage = vi.fn();
    await rebuildWorkMap(session(map("last")), { rescoreOnly: true, synthesize: billing("new"), score, onUsage });
    expect(onUsage).not.toHaveBeenCalled();
  });

  it("a throwing onUsage never changes the rebuild", async () => {
    const onUsage = vi.fn(() => {
      throw new Error("meter down");
    });
    const first = await rebuildWorkMap(session(), { synthesize: billing("new"), score, onUsage });
    expect(first).toEqual({ workmap: map("new"), mode: "full" });
    const raced = await rebuildWorkMap(session(map("last")), { synthesize: billing("new"), score, onUsage, timeoutMs: 1000 });
    expect(raced).toEqual({ workmap: map("new"), mode: "full" });
    expect(onUsage).toHaveBeenCalledTimes(2);
  });
});
