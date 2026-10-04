import { describe, expect, it, vi } from "vitest";
import { pipWorkMap } from "@/lib/fixtures/preview";
import type { WorkMap } from "@/lib/types";
import { deleteProcess, patchProcess, restoreVersion, saveWorkMap } from "./client";
import {
  addGuardrail,
  canArchiveProcess,
  canDeleteProcess,
  canEditProcess,
  deleteGuardrail,
  deleteStep,
  editGuardrail,
  editStep,
  moveStep,
  StepNotFoundError,
} from "./edit";

const wm: WorkMap = structuredClone(pipWorkMap);
const withShortcuts: WorkMap = {
  ...wm,
  shortcuts: [
    { chord: wm.shortcuts?.[0]?.chord ?? ["Ctrl", "S"], app: "ERP", effect: "save", first_t: 1, count: 1, step: 1 },
    { chord: wm.shortcuts?.[0]?.chord ?? ["Ctrl", "S"], app: "ERP", effect: "post", first_t: 2, count: 1, step: 2 },
  ],
} as WorkMap;

describe("process edits (slice d)", () => {
  it("edits a step's title and decision, keeps the quote unmarked when unchanged", () => {
    const s = wm.steps[0];
    const out = editStep(wm, s.n, { title: "  New   title ", decision: "New decision", reason: s.reason?.quote }, "Sabine");
    expect(out.steps[0].title).toBe("New title");
    expect(out.steps[0].decision).toBe("New decision");
    expect(out.steps[0].reason?.edited_by).toBeUndefined();
    expect(wm.steps[0].title).toBe(s.title); // input untouched
  });

  it("marks an edited reason quote with the editor; blank fields change nothing", () => {
    const s = wm.steps[0];
    const out = editStep(wm, s.n, { title: " ", reason: "Because the auditor asks for it" }, "Sabine Keller");
    expect(out.steps[0].title).toBe(s.title);
    expect(out.steps[0].reason).toMatchObject({ quote: "Because the auditor asks for it", edited_by: "Sabine Keller" });
  });

  it("adds a reason to a step without one, marked as edited", () => {
    const bare: WorkMap = { ...wm, steps: wm.steps.map((s, i) => (i === 0 ? { ...s, reason: null } : s)) };
    const out = editStep(bare, bare.steps[0].n, { reason: "Typed by hand" }, "Ana");
    expect(out.steps[0].reason).toMatchObject({ quote: "Typed by hand", source: "debrief", edited_by: "Ana", t: bare.steps[0].screen_moment.t });
  });

  it("reorders steps, renumbers them and moves shortcuts along", () => {
    const [a, b] = withShortcuts.steps;
    const out = moveStep(withShortcuts, 2, -1);
    expect(out.steps.map((s) => [s.n, s.title]).slice(0, 2)).toEqual([[1, b.title], [2, a.title]]);
    expect(out.shortcuts?.map((s) => [s.effect, s.step])).toEqual([["save", 2], ["post", 1]]);
    expect(moveStep(withShortcuts, 1, -1)).toBe(withShortcuts);
  });

  it("deletes a step, renumbers the rest and drops the deleted step's shortcut step", () => {
    const out = deleteStep(withShortcuts, 1);
    expect(out.steps).toHaveLength(withShortcuts.steps.length - 1);
    expect(out.steps.map((s) => s.n)).toEqual(out.steps.map((_, i) => i + 1));
    expect(out.steps[0].title).toBe(withShortcuts.steps[1].title);
    expect(out.shortcuts?.map((s) => [s.effect, s.step])).toEqual([["save", undefined], ["post", 1]]);
    expect(() => deleteStep(wm, 99)).toThrow(StepNotFoundError);
  });

  it("adds, edits (quote marked) and deletes guardrails", () => {
    const n = wm.steps[0].n;
    const before = wm.steps[0].guardrails.length;
    const added = addGuardrail(wm, n, { rule: "Never pay twice", kind: "stop_and_ask", quote: "Check the duplicate list" }, "Ana");
    const g = added.steps[0].guardrails[before];
    expect(g).toMatchObject({ rule: "Never pay twice", kind: "stop_and_ask", quote: "Check the duplicate list", edited_by: "Ana" });
    expect(addGuardrail(wm, n, { rule: "  ", kind: "limit" }, "Ana")).toBe(wm);

    const edited = editGuardrail(added, n, before, { rule: "Never pay an invoice twice", kind: "limit" }, "Ben");
    expect(edited.steps[0].guardrails[before]).toMatchObject({ rule: "Never pay an invoice twice", kind: "limit", edited_by: "Ana" });
    const requoted = editGuardrail(edited, n, before, { quote: "New words" }, "Ben");
    expect(requoted.steps[0].guardrails[before]).toMatchObject({ quote: "New words", edited_by: "Ben" });

    const removed = deleteGuardrail(requoted, n, before);
    expect(removed.steps[0].guardrails).toEqual(wm.steps[0].guardrails);
  });

  it("archive and delete are owner actions; owner and expert edit", () => {
    expect([canEditProcess("owner"), canEditProcess("expert"), canEditProcess("learner"), canEditProcess(null)]).toEqual([true, true, false, false]);
    expect([canArchiveProcess("owner"), canArchiveProcess("expert")]).toEqual([true, false]);
    expect([canDeleteProcess("owner"), canDeleteProcess("expert"), canDeleteProcess("learner")]).toEqual([true, false, false]);
  });
});

describe("process client calls", () => {
  const ok = (body: unknown, status = 200) => new Response(status === 204 ? null : JSON.stringify(body), { status });

  it("rename, archive and an edit PATCH the process; an edit sends the version it is based on", async () => {
    const f = vi.fn(async () => ok({ id: "p1" }));
    await patchProcess("p1", { title: "New" }, f as never);
    await patchProcess("p1", { archived: true }, f as never);
    await saveWorkMap({ id: "p1", version: 3 }, wm, f as never);
    const calls = f.mock.calls as unknown as [string, RequestInit][];
    expect(calls.map(([u, i]) => [u, i.method, JSON.parse(String(i.body))])).toEqual([
      ["/api/processes/p1", "PATCH", { title: "New" }],
      ["/api/processes/p1", "PATCH", { archived: true }],
      ["/api/processes/p1", "PATCH", { workmap: wm, expected_version: 3 }],
    ]);
  });

  it("restore writes the old Work Map as a new version", async () => {
    const f = vi.fn(async () => ok({ id: "p1", version: 4 }));
    const old = editStep(wm, wm.steps[0].n, { title: "Old title" }, "x");
    await restoreVersion({ id: "p1", version: 3 }, { workmap: old }, f as never);
    const [u, init] = (f.mock.calls as unknown as [string, RequestInit][])[0];
    expect(u).toBe("/api/processes/p1");
    expect(JSON.parse(String(init.body))).toEqual({ workmap: old, expected_version: 3 });
  });

  it("delete answers null on 204; 403, 409 and 503 become sentences", async () => {
    expect(await deleteProcess("p1", (async () => ok(null, 204)) as never)).toBeNull();
    await expect(deleteProcess("p1", (async () => ok({}, 403)) as never)).rejects.toThrow("Your role cannot do this.");
    await expect(patchProcess("p1", { title: "x" }, (async () => ok({}, 409)) as never)).rejects.toThrow("changed meanwhile");
    await expect(patchProcess("p1", { title: "x" }, (async () => ok({}, 503)) as never)).rejects.toThrow("not available yet");
  });
});
