import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AGENT_A, AGENT_B, SESSIONS } from "@/components/agents/fixtures";
import LearnView from "@/components/agents/LearnView";
import { learnAgents, learnProcesses, parseId, teachHref, teachSourceError } from "@/components/agents/model";

describe("learn", () => {
  it("offers only agents with at least one confirmed process", () => {
    expect(learnAgents([AGENT_A, AGENT_B], SESSIONS).map((a) => a.id)).toEqual(["agent-a"]);
    const html = renderToStaticMarkup(<LearnView agents={learnAgents([AGENT_A, AGENT_B], SESSIONS)} selected={null} processes={[]} unknownAgent={false} />);
    expect(html).toContain('href="/learn?agent=agent-a"');
    expect(html).not.toContain("agent-b");
  });

  it("agent then process builds /teach?agent=<id>&session=<id>", () => {
    expect(teachHref("agent-a", "cap-1")).toBe("/teach?agent=agent-a&session=cap-1");
    const processes = learnProcesses("agent-a", SESSIONS);
    expect(processes.map((p) => p.teachHref)).toEqual(["/teach?agent=agent-a&session=cap-1"]);
    const [card] = learnAgents([AGENT_A], SESSIONS);
    const html = renderToStaticMarkup(<LearnView agents={[card]} selected={card} processes={processes} unknownAgent={false} />);
    expect(html).toContain('href="/teach?agent=agent-a&amp;session=cap-1"');
    expect(html).toContain("Send a quote");
  });

  it("an unknown agent shows an error and the gallery; no agents shows the empty text", () => {
    const html = renderToStaticMarkup(<LearnView agents={learnAgents([AGENT_A], SESSIONS)} selected={null} processes={[]} unknownAgent />);
    expect(html).toContain('role="alert"');
    expect(renderToStaticMarkup(<LearnView agents={[]} selected={null} processes={[]} unknownAgent={false} />)).toContain(
      "No agent has a confirmed process yet",
    );
  });

  it("teach source must be a Work Map of the same agent", () => {
    const cap = SESSIONS[0];
    expect(teachSourceError("agent-a", cap)).toBeNull();
    expect(teachSourceError("agent-b", cap)).toMatch(/different agent/);
    expect(teachSourceError("agent-a", null)).toMatch(/not found/);
    expect(teachSourceError("agent-a", SESSIONS[3])).toMatch(/no Work Map/);
  });

  it("parseId accepts short ids only", () => {
    expect(parseId("agent-a")).toBe("agent-a");
    for (const bad of ["", "../x", "a/b", ["x"], null, "x".repeat(65)]) expect(parseId(bad)).toBeNull();
  });
});

describe("learn -> teach for a process", () => {
  it("passes ?process=<id> next to the session", () => {
    expect(teachHref("agent-a", "cap-1", "proc-1")).toBe("/teach?agent=agent-a&session=cap-1&process=proc-1");
    expect(teachHref("agent-a", "cap-1", null)).toBe("/teach?agent=agent-a&session=cap-1");
  });
});
