import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import Dashboard from "@/components/dashboard/Dashboard";
import { buildDashboard } from "@/lib/dashboard/summary";
import type { Session } from "@/lib/types";

const base = { events: [], transcript: [], qa: [], off_record_ranges: [] };
const sessions: Session[] = [
  {
    ...base,
    id: "c1",
    kind: "capture",
    started_at: "2026-10-03T21:05:00Z",
    ended_at: "2026-10-03T21:40:00Z",
    workmap: { task: "Approve invoices", expert: "Lena", confirmed_by_expert: true, steps: [], open_questions: [] },
  },
  {
    ...base,
    id: "t1",
    kind: "teach",
    started_at: "2026-10-03T22:00:00Z",
    teach: { workmap_session_id: "c1", mastered: ["a"], practice: ["b"], interventions: 2, finished_at: "2026-10-03T22:15:00Z" },
  },
];
const members = [{ userId: "u1", label: "anna@example.com", role: "learner" }];

describe("Dashboard", () => {
  it("renders the three card groups with ISO dates and 24 h Zurich time", () => {
    const html = renderToStaticMarkup(
      <Dashboard summary={buildDashboard(sessions, members, { t1: "u1" })} role="owner" />,
    );
    for (const title of ["Captured workflows", "Learners", "Quick actions"]) expect(html).toContain(`>${title}</h2>`);
    expect(html).toContain("Lena");
    expect(html).toContain("confirmed");
    // 21:40Z and 22:15Z are 23:40 and 00:15 next day in Zurich (CEST).
    expect(html).toContain("2026-10-03 23:40");
    expect(html).toContain("2026-10-04 00:15");
    expect(html).toContain("anna@example.com");
    expect(html).toContain("Interventions: 2");
    for (const a of ["Start a capture", "Start tutoring", "Invite a colleague", "Install the desktop companion"]) {
      expect(html).toContain(a);
    }
  });

  it("empty states guide to capture and invite; learners do not get 'Start a capture'", () => {
    const html = renderToStaticMarkup(<Dashboard summary={{ experts: [], learners: [] }} role="learner" />);
    expect(html).toContain("No captures yet");
    expect(html).toContain('href="/capture"');
    expect(html).toContain("No learners yet");
    expect(html).toContain('href="/workspace"');
    expect(html).not.toContain("Start a capture");
  });
});
