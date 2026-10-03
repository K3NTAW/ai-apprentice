import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentGallery from "@/components/agents/AgentGallery";
import { AGENT_A, AGENT_B, SESSIONS } from "@/components/agents/fixtures";
import { galleryCards, statText } from "@/components/agents/model";

describe("agent gallery", () => {
  it("cards carry name, role, expert line and stats from agentStats", () => {
    const cards = galleryCards([AGENT_A, AGENT_B], SESSIONS);
    expect(cards.map((c) => c.name)).toEqual(["AP Clerk", "Senior Sales Person"]);
    const a = cards.find((c) => c.id === "agent-a")!;
    expect(a.expert).toBe("learns from Sabine");
    expect(a.stats).toMatchObject({ processes: 1, guardrails: 1, shortcuts: null });
    expect(a.href).toBe("/agents/agent-a");
    expect(cards.find((c) => c.id === "agent-b")!.expert).toBe("no expert named yet");
  });

  it("renders the cards, the stats and the '+ New agent' card", () => {
    const html = renderToStaticMarkup(<AgentGallery cards={galleryCards([AGENT_A], SESSIONS)} canCreate />);
    for (const text of ["Senior Sales Person", "Prepares and sends quotes", "learns from Sabine", "Processes", "Shortcuts", "Guardrails", "Learners"]) {
      expect(html).toContain(text);
    }
    expect(html).toContain('href="/agents/agent-a"');
    expect(html).toContain('href="/agents/new"');
    expect(html).toContain("+ New agent");
    expect(html).toContain("none yet");
    expect(html).toContain('src="data:image/svg+xml;base64,');
    expect(html).not.toContain("An agent learns one job");
  });

  it("empty state explains the idea in two lines; learners get no create card", () => {
    const html = renderToStaticMarkup(<AgentGallery cards={[]} canCreate={false} />);
    expect(html).toContain("An agent learns one job from an expert");
    expect(html).toContain("A new employee then picks the agent");
    expect(html).not.toContain("+ New agent");
  });

  it("null shortcuts show 'none yet'", () => {
    expect(statText(null)).toBe("none yet");
    expect(statText(0)).toBe("0");
  });
});
