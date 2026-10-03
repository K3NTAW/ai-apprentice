import { describe, expect, it } from "vitest";
import type { Session, WorkMap } from "@/lib/types";
import { mapListRows } from "./list";

const workmap = (confirmed: boolean): WorkMap => ({
  task: "AP",
  expert: "Sabine",
  confirmed_by_expert: confirmed,
  steps: [],
  open_questions: [],
});

const session = (id: string, started_at: string, wm?: WorkMap, kind: Session["kind"] = "capture"): Session => ({
  id,
  kind,
  started_at,
  events: [],
  transcript: [],
  qa: [],
  off_record_ranges: [],
  ...(wm ? { workmap: wm } : {}),
});

describe("mapListRows", () => {
  it("formats dates as ISO date and 24 h time in Europe/Zurich", () => {
    // 13:05 UTC is 15:05 in Zurich in summer (CEST) and 14:05 in winter (CET).
    const [summer] = mapListRows([session("a", "2026-07-01T13:05:00Z", workmap(true))]);
    expect(summer.date).toBe("2026-07-01 15:05");
    const [winter] = mapListRows([session("b", "2026-01-15T13:05:00Z", workmap(true))]);
    expect(winter.date).toBe("2026-01-15 14:05");
    // Past midnight in Zurich is the next ISO date, and the hour is 00, not 12 AM.
    const [late] = mapListRows([session("c", "2026-10-02T22:30:00Z", workmap(true))]);
    expect(late.date).toBe("2026-10-03 00:30");
  });

  it("shows the confirmed badge only for confirmed maps", () => {
    const rows = mapListRows([session("yes", "2026-10-01T08:00:00Z", workmap(true)), session("no", "2026-10-02T08:00:00Z", workmap(false))]);
    expect(rows.map((r) => [r.id, r.confirmed])).toEqual([
      ["no", false],
      ["yes", true],
    ]);
  });

  it("lists capture sessions with a Work Map only, newest first, with counts and a link", () => {
    const rows = mapListRows([
      session("old", "2026-09-01T08:00:00Z", workmap(true)),
      session("none", "2026-10-01T08:00:00Z"),
      session("teach", "2026-10-01T08:00:00Z", workmap(true), "teach"),
      session("new", "2026-10-02T08:00:00Z", workmap(false)),
    ]);
    expect(rows.map((r) => r.id)).toEqual(["new", "old"]);
    expect(rows[0]).toMatchObject({ expert: "Sabine", counts: "0 steps · 0 judgment calls · 0 guardrails", href: "/map/new" });
  });
});
