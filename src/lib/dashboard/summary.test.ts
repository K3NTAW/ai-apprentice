import { describe, expect, it } from "vitest";
import type { Session, WorkMap } from "@/lib/types";
import { buildDashboard, workflowStatus, workmapLearners, type DashboardMember } from "./summary";

const workmap = (over: Partial<WorkMap> = {}): WorkMap => ({
  task: "Approve invoices",
  expert: "Lena",
  confirmed_by_expert: false,
  steps: [
    {
      n: 1,
      title: "Check supplier",
      screen_moment: { t: 1, entity: "invoice" },
      decision: "ok",
      is_judgment_call: true,
      reason: null,
      guardrails: [],
      scores: { reason_captured: 1, guardrail_captured: 1 },
    },
    {
      n: 2,
      title: "Set cost center",
      screen_moment: { t: 2, entity: "invoice" },
      decision: "ok",
      is_judgment_call: false,
      reason: null,
      guardrails: [],
      scores: { reason_captured: 1, guardrail_captured: 1 },
    },
  ],
  open_questions: [],
  ...over,
});

const session = (over: Partial<Session> & Pick<Session, "id" | "kind" | "started_at">): Session => ({
  events: [],
  transcript: [],
  qa: [],
  off_record_ranges: [],
  ...over,
});

const capturing = session({ id: "c1", kind: "capture", started_at: "2026-10-01T08:00:00Z", expert: "Marco" });
const pending = session({
  id: "c2",
  kind: "capture",
  started_at: "2026-10-02T08:00:00Z",
  ended_at: "2026-10-02T09:00:00Z",
  workmap: workmap(),
});
const confirmed = session({
  id: "c3",
  kind: "capture",
  started_at: "2026-10-03T07:00:00Z",
  ended_at: "2026-10-03T07:30:00Z",
  workmap: workmap({ confirmed_by_expert: true }),
});
const teachOld = session({
  id: "t1",
  kind: "teach",
  started_at: "2026-10-03T08:00:00Z",
  teach: { workmap_session_id: "c3", mastered: [], practice: ["1", "2"], interventions: 3 },
});
const teachNew = session({
  id: "t2",
  kind: "teach",
  started_at: "2026-10-03T10:00:00Z",
  teach: {
    workmap_session_id: "c3",
    mastered: ["1"],
    practice: ["2"],
    interventions: 1,
    finished_at: "2026-10-03T10:20:00Z",
  },
});
const teachOther = session({
  id: "t3",
  kind: "teach",
  started_at: "2026-10-03T11:00:00Z",
  teach: { workmap_session_id: "c3", mastered: ["1", "2"], practice: [], interventions: 0 },
});
const sessions = [capturing, pending, confirmed, teachOld, teachNew, teachOther];
const members: DashboardMember[] = [
  { userId: "u-owner", label: "lena@example.com", role: "owner" },
  { userId: "u-anna", label: "anna@example.com", role: "learner" },
  { userId: "u-ben", label: "ben@example.com", role: "learner" },
];
const createdBy = { t1: "u-anna", t2: "u-anna", t3: "u-owner" };

describe("dashboard summary", () => {
  it("status: capturing, debrief pending, confirmed", () => {
    expect(workflowStatus(capturing)).toBe("capturing");
    expect(workflowStatus(pending)).toBe("debrief pending");
    expect(workflowStatus({ ...capturing, ended_at: "2026-10-01T09:00:00Z" })).toBe("debrief pending");
    expect(workflowStatus(confirmed)).toBe("confirmed");
  });

  it("groups capture sessions per expert, newest first, with counts and Zurich dates", () => {
    const { experts } = buildDashboard(sessions, members, createdBy);
    expect(experts.map((e) => e.expert)).toEqual(["Lena", "Marco"]);
    expect(experts[0].workflows.map((w) => [w.sessionId, w.status])).toEqual([
      ["c3", "confirmed"],
      ["c2", "debrief pending"],
    ]);
    expect(experts[0].workflows[0].updated).toBe("2026-10-03 09:30");
    expect(experts[0].workflows[0].counts).toContain("2");
    expect(experts[0].workflows[0].href).toBe("/map/c3");
    expect(experts[1].workflows[0]).toMatchObject({ status: "capturing", counts: "", updated: "2026-10-01 10:00" });
  });

  it("per learner: latest linked teach session per confirmed Work Map, step ids as titles", () => {
    const { learners } = buildDashboard(sessions, members, createdBy);
    expect(learners.map((l) => l.label)).toEqual(["anna@example.com", "ben@example.com"]);
    expect(learners[0].mastery).toEqual([
      {
        workmapSessionId: "c3",
        task: "Approve invoices",
        learner: "anna@example.com",
        date: "2026-10-03 12:20",
        mastered: ["Check supplier"],
        practiceNext: ["Set cost center"],
        interventions: 1,
        finished: true,
      },
    ]);
    expect(learners[1].mastery).toEqual([]);
  });

  it("ignores teach sessions linked to unconfirmed maps on the dashboard", () => {
    const linkedToPending = session({
      id: "t4",
      kind: "teach",
      started_at: "2026-10-03T12:00:00Z",
      teach: { workmap_session_id: "c2", mastered: [], practice: [], interventions: 0 },
    });
    const { learners } = buildDashboard([...sessions, linkedToPending], members, { ...createdBy, t4: "u-ben" });
    expect(learners[1].mastery).toEqual([]);
  });

  it("Work Map learners: one latest row per person, unknown creator kept per session", () => {
    const rows = workmapLearners("c3", sessions, members, createdBy);
    expect(rows.map((r) => [r.learner, r.date])).toEqual([
      ["lena@example.com", "2026-10-03 13:00"],
      ["anna@example.com", "2026-10-03 12:20"],
    ]);
    expect(workmapLearners("c3", sessions, members, {}).map((r) => r.learner)).toEqual(["unknown", "unknown", "unknown"]);
    expect(workmapLearners("nope", sessions, members, createdBy)).toEqual([]);
  });
});
