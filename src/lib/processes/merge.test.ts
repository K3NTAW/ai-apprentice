import { describe, expect, it } from "vitest";
import type { Process } from "@/lib/store/types";
import type { SessionDigest, WorkMap } from "@/lib/types";
import { workMapItems } from "@/lib/workmap/items";
import { agentWorkMaps, isLegacyConfirmed, teachWorkMapSessions } from "./merge";

const A = "agent-a";
const step = { n: 1 } as unknown as WorkMap["steps"][number];
const wm = (task: string, confirmed = true): WorkMap => ({ task, expert: "S", confirmed_by_expert: confirmed, steps: [step], open_questions: [] });
const s = (id: string, day: number, workmap: WorkMap, process_id?: string) =>
  ({ id, kind: "capture", agent_id: A, started_at: `2026-09-0${day}T08:00:00.000Z`, workmap, ...(process_id ? { process_id } : {}) }) as unknown as SessionDigest;
const p = (id: string, title: string, extra: Partial<Process> = {}): Process => ({
  id,
  workspace_id: "w",
  agent_id: A,
  title,
  workmap: wm(title),
  version: 1,
  confirmed: true,
  archived_at: null,
  created_by: null,
  created_at: "2026-09-05T08:00:00.000Z",
  updated_at: "2026-09-05T08:00:00.000Z",
  ...extra,
});

describe("agentWorkMaps", () => {
  it("never lists an empty run: a session or process whose Work Map has no steps (the 'unspecified task' entry)", () => {
    const empty = { ...wm("unspecified task"), steps: [] };
    expect(isLegacyConfirmed(s("blank", 1, empty))).toBe(false);
    const maps = agentWorkMaps(A, [p("pe", "unspecified task", { workmap: empty }), p("p1", "Proc")], [s("blank", 1, empty), s("legacy", 2, wm("legacy"))]);
    expect(maps.map((m) => m.id)).toEqual(["p1", "legacy"]);
  });

  it("links a process to its newest linked capture session, legacy sessions to themselves", () => {
    const sessions = [s("old", 1, wm("v1"), "p1"), s("new", 2, wm("v2"), "p1"), s("legacy", 3, wm("legacy"))];
    expect(agentWorkMaps(A, [p("p1", "Proc"), p("p2", "Unlinked")], sessions).map((m) => [m.id, m.sessionId])).toEqual([
      ["p1", "new"],
      ["p2", null],
      ["legacy", "legacy"],
    ]);
  });
});

describe("teachWorkMapSessions (Teach reads agentWorkMaps)", () => {
  const sessions = [s("old", 1, wm("v1"), "p1"), s("new", 2, wm("v2", false), "p1"), s("legacy", 3, wm("legacy")), s("arch", 4, wm("a"), "p2")];
  const processes = [p("p1", "Pay invoices", { workmap: wm("merged") }), p("p2", "Archived", { archived_at: "2026-09-06T08:00:00.000Z" })];

  it("offers each process once with its current Work Map on its newest session, legacy maps unchanged, archived none", () => {
    const { maps } = workMapItems(teachWorkMapSessions(sessions, processes), { confirmed: true, agentId: null, sessionId: null, limit: 50 });
    expect(maps.map((m) => [m.id, m.workmap.task])).toEqual([
      ["legacy", "legacy"],
      ["new", "Pay invoices"],
    ]);
    // ?session_id of the process's session loads the process Work Map.
    const { session } = workMapItems(teachWorkMapSessions(sessions, processes), { confirmed: true, agentId: null, sessionId: "new", limit: 1 });
    expect(session?.workmap).toMatchObject({ task: "Pay invoices", confirmed_by_expert: true });
  });

  it("returns the sessions as they are without processes", () => {
    expect(teachWorkMapSessions(sessions, [])).toEqual(sessions);
  });
});
