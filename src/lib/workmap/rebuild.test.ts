import { describe, expect, it, vi } from "vitest";
import type { Session, WorkMap } from "@/lib/types";
import { rebuildWorkMap } from "./rebuild";

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
