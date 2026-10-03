import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentDetail, { type AgentDetailProps } from "@/components/agents/AgentDetail";
import { AGENT_A, CREATED_BY, MEMBERS, SESSIONS } from "@/components/agents/fixtures";
import {
  agentGuardrails,
  agentLearners,
  agentProcesses,
  agentShortcuts,
  parseTab,
  type AgentTab,
} from "@/components/agents/model";
import { agentStats } from "@/lib/agents/stats";

const props = (tab: AgentTab, over: Partial<AgentDetailProps> = {}): AgentDetailProps => ({
  agent: AGENT_A,
  role: "owner",
  tab,
  stats: agentStats(AGENT_A.id, SESSIONS),
  processes: agentProcesses(AGENT_A.id, SESSIONS),
  shortcuts: agentShortcuts(AGENT_A.id, SESSIONS),
  guardrails: agentGuardrails(AGENT_A.id, SESSIONS),
  learners: agentLearners(AGENT_A.id, SESSIONS, MEMBERS, CREATED_BY),
  ...over,
});
const render = (tab: AgentTab, over?: Partial<AgentDetailProps>) => renderToStaticMarkup(<AgentDetail {...props(tab, over)} />);

describe("agent page", () => {
  it("header: name, role, expert, Train and Teach buttons, tab links", () => {
    const html = render("processes");
    expect(html).toContain("Senior Sales Person");
    expect(html).toContain("learns from Sabine");
    expect(html).toContain('href="/capture?agent=agent-a"');
    expect(html).toContain("Train (capture)");
    expect(html).toContain('href="/learn?agent=agent-a"');
    expect(html).toContain("Teach a new employee");
    for (const t of ["shortcuts", "guardrails", "learners", "settings"]) expect(html).toContain(`href="/agents/agent-a?tab=${t}"`);
    expect(render("processes", { role: "learner" })).not.toContain("Train (capture)");
  });

  it("processes: only confirmed Work Maps with counts and a link", () => {
    const html = render("processes");
    expect(html).toContain("Send a quote");
    expect(html).toContain('href="/map/cap-1"');
    expect(html).not.toContain("Draft");
    expect(html).toMatch(/2 steps/);
  });

  it("guardrails: rule, expert quote and a link to the screen moment", () => {
    const rows = agentGuardrails(AGENT_A.id, SESSIONS);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rule: "Never discount above 15%", quote: "Above 15% I ask my boss.", href: "/map/cap-1#step-1" });
    const html = render("guardrails");
    expect(html).toContain("Never discount above 15%");
    expect(html).toContain("<q");
    expect(html).toContain("Above 15% I ask my boss.");
    expect(html).toContain('href="/map/cap-1#step-1"');
  });

  it("learners: latest session per learner and process sets the mastery", () => {
    const rows = agentLearners(AGENT_A.id, SESSIONS, MEMBERS, CREATED_BY);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ label: "anna@example.com", mastered: 1, steps: 2 });
    expect(rows[0].processes).toHaveLength(1);
    expect(rows[0].processes[0].interventions).toBe(1);
    const html = render("learners");
    expect(html).toContain("anna@example.com");
    expect(html).toContain("1 of 2 steps mastered (50%)");
    const unknown = agentLearners(AGENT_A.id, SESSIONS, [], {});
    expect(unknown.every((r) => r.label === "unknown learner")).toBe(true);
  });

  it("shortcuts glossary from Work Map shortcuts when present, malformed entries skipped", () => {
    const rows = agentShortcuts(AGENT_A.id, SESSIONS);
    expect(rows).toEqual([
      expect.objectContaining({ chord: "Cmd+Shift+T", app: "Microsoft Outlook", what: "Insert the quote template", why: "Saves retyping the terms." }),
    ]);
    const html = render("shortcuts");
    expect(html).toContain("Cmd+Shift+T");
    expect(html).toContain("Microsoft Outlook");
    expect(html).toContain("Insert the quote template");
    expect(html).toContain("Saves retyping the terms.");
  });

  it("empty tabs explain themselves", () => {
    const empty = { processes: [], shortcuts: [], guardrails: [], learners: [] };
    expect(render("shortcuts", empty)).toContain("No shortcuts recorded yet");
    expect(render("guardrails", empty)).toContain("No guardrails yet");
    expect(render("learners", empty)).toContain("Nobody has practised");
    expect(render("processes", empty)).toContain("No confirmed processes yet");
  });

  it("parseTab falls back to processes", () => {
    expect(parseTab("guardrails")).toBe("guardrails");
    expect(parseTab("nope")).toBe("processes");
    expect(parseTab(["learners"])).toBe("processes");
  });
});
