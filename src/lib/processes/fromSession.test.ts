// End of the debrief over the file store: the match suggestion, add (merge), replace and new, each with a version row.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileStore } from "@/lib/store";
import type { WorkMap, WorkMapStep } from "@/lib/types";
import { saveFromSession, SessionNotConfirmedError, suggestForSession } from "./server";

let dir: string;
const prev = process.env.DATA_DIR;
beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), "apprentice-from-session-"));
  process.env.DATA_DIR = dir;
});
afterAll(async () => {
  if (prev === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = prev;
  await rm(dir, { recursive: true, force: true });
});

const avatar = { shape: "blob", face: "smile", color: "#3366FF", accent: "#FFCC00" } as const;
const step = (n: number, title: string, over: Partial<WorkMapStep> = {}): WorkMapStep => ({
  n,
  title,
  screen_moment: { t: n, app: "SAP", entity: "invoice" },
  decision: "approve",
  is_judgment_call: false,
  reason: null,
  guardrails: [],
  scores: { reason_captured: 1, guardrail_captured: 1 },
  ...over,
});
const map = (steps: WorkMapStep[], confirmed = true): WorkMap => ({ task: "Approve invoices", expert: "Sabine", confirmed_by_expert: confirmed, steps, open_questions: [] });

async function confirmedSession(agentId: string, wm: WorkMap): Promise<string> {
  const s = await fileStore.createSession({ kind: "capture", agent_id: agentId });
  await fileStore.saveWorkMap(s.id, wm);
  return s.id;
}

describe("saveFromSession / suggestForSession", () => {
  it("first session: new process; second: suggested, merged without dropping old guardrails, versioned; third: replaced", async () => {
    const agent = await fileStore.createAgent({ name: "Pip", role: "AP", avatar });
    const guard = { rule: "Over 10k needs a second approval", quote_ref: 1, kind: "limit" as const, quote: "over ten thousand" };
    const s1 = await confirmedSession(agent.id, map([step(1, "Open invoice", { guardrails: [guard], reason: { quote: "PO first", t: 1, source: "debrief" } })]));

    const first = await suggestForSession(fileStore, s1);
    expect(first).toEqual({ linked: null, match: { choice: "new", confidence: 1, title: null }, candidates: [] });
    const created = (await saveFromSession(fileStore, { session_id: s1, choice: "new" })).process!;
    expect(created.version).toBe(1);
    expect((await suggestForSession(fileStore, s1)).linked?.id).toBe(created.id);

    const s2 = await confirmedSession(
      agent.id,
      map([step(1, "Open invoice", { reason: { quote: "vendor first", t: 2, source: "narration" } }), step(2, "Post invoice", { screen_moment: { t: 3, app: "SAP", entity: "posting" } })]),
    );
    const suggestion = await suggestForSession(fileStore, s2, async (state) => ({ answer: state.processes[0]!.id, confidence: 0.8 }));
    expect(suggestion.match).toEqual({ choice: created.id, confidence: 0.8, title: "Approve invoices" });

    const preview = await saveFromSession(fileStore, { session_id: s2, choice: "add", process_id: created.id, preview: true });
    expect(preview.process).toBeNull();
    expect((await fileStore.getProcess(created.id))!.version).toBe(1);
    expect(preview.conflicts).toHaveLength(1);

    const added = (await saveFromSession(fileStore, { session_id: s2, choice: "add", process_id: created.id })).process!;
    expect(added.version).toBe(2);
    expect(added.workmap.steps.map((s) => s.title)).toEqual(["Open invoice", "Post invoice"]);
    expect(added.workmap.steps[0]!.guardrails).toEqual([guard]);
    expect(added.workmap.steps[0]!.reason?.quote).toBe("PO first");
    expect(added.workmap.open_questions).toHaveLength(1);

    const s3 = await confirmedSession(agent.id, map([step(1, "Scan invoice", { screen_moment: { t: 1, app: "Scanner", entity: "pdf" } })]));
    const replaced = (await saveFromSession(fileStore, { session_id: s3, choice: "replace", process_id: created.id })).process!;
    expect(replaced.version).toBe(3);
    expect(replaced.workmap.steps.map((s) => s.title)).toEqual(["Scan invoice"]);

    const versions = await fileStore.listProcessVersions(created.id);
    expect(versions.map((v) => [v.version, v.change_kind, v.source_session_id])).toEqual([
      [3, "replaced", s3],
      [2, "extended", s2],
      [1, "trained", s1],
    ]);
    expect(versions[1]!.workmap.steps[0]!.guardrails).toEqual([guard]);
  });

  it("rejects a session without a confirmed Work Map", async () => {
    const agent = await fileStore.createAgent({ name: "Ada", role: "AP", avatar });
    const s = await confirmedSession(agent.id, map([step(1, "Open invoice")], false));
    await expect(saveFromSession(fileStore, { session_id: s, choice: "new" })).rejects.toBeInstanceOf(SessionNotConfirmedError);
  });
});
