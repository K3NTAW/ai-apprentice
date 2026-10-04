import { describe, expect, it } from "vitest";
import type { Guardrail, WorkMap, WorkMapShortcut } from "@/lib/types";
import { statText } from "@/components/agents/model";
import { agentStats, type AgentStatsSession } from "./stats";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const g = (rule: string): Guardrail => ({ rule, quote_ref: 1, kind: "limit" });
const sc = (chord: string, app = "Microsoft Excel"): WorkMapShortcut => ({ chord, app, effect: "e", first_t: 1, count: 1 });
const workmap = (confirmed: boolean, rules: string[][], shortcuts?: WorkMapShortcut[]): WorkMap => ({
  task: "quote",
  expert: "Sabine",
  confirmed_by_expert: confirmed,
  steps: rules.map((r, i) => ({
    n: i + 1,
    title: `step ${i + 1}`,
    screen_moment: { t: i, entity: "deal" },
    decision: "d",
    is_judgment_call: false,
    reason: null,
    guardrails: r.map(g),
    scores: { reason_captured: 1, guardrail_captured: 1 },
  })),
  open_questions: [],
  ...(shortcuts ? { shortcuts } : {}),
});

const s = (x: Partial<AgentStatsSession>): AgentStatsSession => ({ kind: "capture", started_at: "2026-10-01T08:00:00.000Z", agent_id: A, ...x });

const FIXTURE: AgentStatsSession[] = [
  s({ workmap: workmap(true, [["No discount over 15%.", "Ask legal for new customers"]], [sc("Cmd+D"), sc("Cmd+Shift+L")]), ended_at: "2026-10-01T09:00:00.000Z" }),
  s({ workmap: workmap(true, [["  no discount   over 15%. "], ["Check credit limit"]], [sc("cmd + d", "Microsoft Outlook"), sc("Cmd+J", "Microsoft Outlook")]), started_at: "2026-10-03T10:00:00.000Z" }),
  // Not confirmed: not a process, its guardrails do not count.
  s({ workmap: workmap(false, [["Unconfirmed rule"]], [sc("Cmd+K")]), started_at: "2026-10-02T10:00:00.000Z", ended_at: "2026-10-02T11:00:00.000Z" }),
  s({ kind: "teach", created_by: "u1", started_at: "2026-10-04T10:00:00.000Z" }),
  s({ kind: "teach", created_by: "u1" }),
  s({ kind: "teach", created_by: "u2" }),
  s({ kind: "teach", created_by: null }),
  // Capture creators are not learners.
  s({ created_by: "u9" }),
  // Another agent and an unlinked session.
  s({ agent_id: B, workmap: workmap(true, [["B rule"]]), kind: "capture", started_at: "2026-10-05T00:00:00.000Z" }),
  s({ agent_id: undefined, kind: "teach", created_by: "u3" }),
];

describe("agentStats", () => {
  it("derives processes, guardrails, learners and last trained from the agent's sessions", () => {
    expect(agentStats(A, FIXTURE)).toEqual({
      processes: 2,
      shortcuts: 3,
      guardrails: 3,
      learners: 2,
      last_trained: "2026-10-03T10:00:00.000Z",
    });
  });

  it("keeps other agents apart", () => {
    expect(agentStats(B, FIXTURE)).toEqual({
      processes: 1,
      shortcuts: null,
      guardrails: 1,
      learners: 0,
      last_trained: "2026-10-05T00:00:00.000Z",
    });
  });

  it("is empty for an agent without sessions", () => {
    expect(agentStats("cccccccc-cccc-4ccc-8ccc-cccccccccccc", FIXTURE)).toEqual({
      processes: 0,
      shortcuts: null,
      guardrails: 0,
      learners: 0,
      last_trained: null,
    });
  });

  it("counts unique chords across confirmed Work Maps; 0 renders as 'none yet'", () => {
    const one = agentStats(A, [s({ workmap: workmap(true, [], [sc("Cmd+J"), sc("CMD+J"), sc("F5")]) })]);
    expect(one.shortcuts).toBe(2);
    expect(statText(one.shortcuts)).toBe("2");
    const none = agentStats(A, [s({ workmap: workmap(true, []) }), s({ workmap: workmap(false, [], [sc("Cmd+J")]) })]);
    expect(none.shortcuts).toBeNull();
    expect(statText(none.shortcuts)).toBe("none yet");
  });
});
