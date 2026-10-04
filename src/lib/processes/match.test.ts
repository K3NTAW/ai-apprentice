import { describe, expect, it, vi } from "vitest";
import type { Process } from "@/lib/store/types";
import type { WorkMap, WorkMapStep } from "@/lib/types";
import { heuristicMatch, matchProcess, matchState, type MatchDecide } from "./match";

const step = (n: number, title: string, entity: string): WorkMapStep => ({
  n,
  title,
  screen_moment: { t: n, app: "SAP", entity },
  decision: "approve",
  is_judgment_call: false,
  reason: null,
  guardrails: [],
  scores: { reason_captured: 1, guardrail_captured: 1 },
});
const map = (task: string, steps: WorkMapStep[]): WorkMap => ({ task, expert: "Sabine", confirmed_by_expert: true, steps, open_questions: [] });
const proc = (id: string, title: string, steps: WorkMapStep[], archived_at: string | null = null) =>
  ({ id, title, workmap: map(title, steps), archived_at }) as Pick<Process, "id" | "title" | "workmap" | "archived_at">;

const invoices = proc("p-inv", "Approve supplier invoices", [step(1, "Open invoice", "invoice"), step(2, "Check amount", "invoice")]);
const travel = proc("p-trv", "Book travel", [step(1, "Open booking", "trip")]);
const next = map("Approve supplier invoices", [step(1, "Open invoice", "invoice")]);

describe("matchProcess", () => {
  it("passes titles and step summaries of non-archived processes to decide and picks its best match", async () => {
    const decide = vi.fn<MatchDecide>(async () => ({ answer: "p-inv", confidence: 0.9 }));
    const r = await matchProcess(next, [invoices, travel, proc("p-old", "Old", [], "2026-10-01T00:00:00Z")], decide);
    expect(r).toEqual({ choice: "p-inv", confidence: 0.9, title: "Approve supplier invoices" });
    const state = decide.mock.calls[0]![0];
    expect(state.processes.map((p) => p.id)).toEqual(["p-inv", "p-trv"]);
    expect(state.processes[0]!.steps).toEqual(["Open invoice · SAP · invoice", "Check amount · SAP · invoice"]);
  });

  it("answers 'new' below the threshold, for 'new', for an unknown id and without processes", async () => {
    expect((await matchProcess(next, [invoices], async () => ({ answer: "p-inv", confidence: 0.49 }))).choice).toBe("new");
    expect((await matchProcess(next, [invoices], async () => ({ answer: "p-inv", confidence: 0.5 }))).choice).toBe("p-inv");
    expect((await matchProcess(next, [invoices], async () => ({ answer: "new", confidence: 0.8 }))).choice).toBe("new");
    expect((await matchProcess(next, [invoices], async () => ({ answer: "p-x", confidence: 0.99 }))).choice).toBe("new");
    const decide = vi.fn();
    expect(await matchProcess(next, [], decide)).toEqual({ choice: "new", confidence: 1, title: null });
    expect(decide).not.toHaveBeenCalled();
  });

  it("falls back to the heuristic when decide fails", async () => {
    const r = await matchProcess(next, [travel, invoices], async () => {
      throw new Error("down");
    });
    expect(r.choice).toBe("p-inv");
  });

  it("heuristic: unrelated work is 'new'", async () => {
    const a = await heuristicMatch(matchState(map("Plan the quarterly roadmap", [step(1, "Draft goals", "slide")]), [invoices, travel]));
    expect(a.confidence).toBeLessThan(0.5);
  });
});
