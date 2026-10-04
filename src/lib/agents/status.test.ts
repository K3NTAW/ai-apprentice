import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { createElement } from "react";
import LearnView from "@/components/agents/LearnView";
import { filterCards, galleryCards, learnAgents, learnProcesses, learnTraining } from "@/components/agents/model";
import type { Agent, SessionDigest } from "@/lib/types";
import { agentStatus, isReadyProcess, understanding, understandingPercent } from "./status";

const step = (reason: number, guardrail: number) => ({ scores: { reason_captured: reason, guardrail_captured: guardrail } });
const wm = (score: number, confirmed = true, task = "Code invoices") =>
  ({ task, confirmed_by_expert: confirmed, steps: [{ ...step(score, score), n: 1, title: "Step", guardrails: [], is_judgment_call: false, screen_moment: { t: 0, entity: "ERP" } }] }) as unknown as SessionDigest["workmap"];
const cap = (id: string, agent: string, workmap: SessionDigest["workmap"] | undefined) =>
  ({ id, agent_id: agent, kind: "capture", started_at: "2026-10-03T08:00:00Z", ended_at: "2026-10-03T08:10:00Z", workmap }) as unknown as SessionDigest;
const agent = (id: string) => ({ id, name: id, role: "Clerk", expert_name: null, avatar: null }) as unknown as Agent;

describe("understanding score", () => {
  it("averages reason and guardrail over steps; unscored and empty count 0", () => {
    expect(understanding({ steps: [step(1, 0.5), step(0.5, 0)] })).toBeCloseTo(0.5);
    expect(understanding({ steps: [{}] })).toBe(0);
    expect(understanding({ steps: [] })).toBe(0);
    expect(understanding(null)).toBe(0);
    expect(understandingPercent({ steps: [step(0.7, 0.8)] })).toBe(75);
  });

  it("threshold edge: 0.75 is ready, 0.74 is not", () => {
    expect(isReadyProcess({ workmap: wm(0.75) })).toBe(true);
    expect(isReadyProcess({ workmap: { confirmed_by_expert: true, steps: [step(0.7, 0.8)] } })).toBe(true);
    expect(isReadyProcess({ workmap: wm(0.74) })).toBe(false);
  });

  it("unconfirmed or archived processes are never ready", () => {
    expect(isReadyProcess({ workmap: wm(1, false) })).toBe(false);
    expect(isReadyProcess({ workmap: wm(1), archived_at: "2026-10-04T07:00:00Z" })).toBe(false);
  });
});

describe("agent status", () => {
  it("ready, training and new", () => {
    expect(agentStatus("a", [cap("s1", "a", wm(0.8))])).toBe("ready");
    expect(agentStatus("a", [cap("s1", "a", wm(0))])).toBe("training"); // the reported bug: 0% was 'Ready to teach'
    expect(agentStatus("a", [cap("s1", "a", wm(1, false))])).toBe("training");
    expect(agentStatus("a", [cap("s1", "a", undefined)])).toBe("training");
    expect(agentStatus("a", [cap("s1", "b", wm(1))])).toBe("new");
  });

  it("uses processes when given, archived ones do not count", () => {
    expect(agentStatus("a", [], [{ agent_id: "a", workmap: wm(0.9), archived_at: null }])).toBe("ready");
    expect(agentStatus("a", [], [{ agent_id: "a", workmap: wm(0.9), archived_at: "2026-10-04T07:00:00Z" }])).toBe("training");
  });

  it("cards and filter tabs use the same rule", () => {
    const sessions = [cap("s1", "ready", wm(0.75)), cap("s2", "low", wm(0.74))];
    const cards = galleryCards([agent("ready"), agent("low"), agent("fresh")], sessions);
    expect(Object.fromEntries(cards.map((c) => [c.id, c.status]))).toEqual({ ready: "ready", low: "training", fresh: "new" });
    expect(filterCards(cards, "", "ready").map((c) => c.id)).toEqual(["ready"]);
    expect(filterCards(cards, "", "training").map((c) => c.id)).toEqual(["low"]);
    expect(learnAgents([agent("ready"), agent("low")], sessions).map((c) => c.id)).toEqual(["ready"]);
    expect(learnTraining([agent("ready"), agent("low")], sessions).map((c) => c.id)).toEqual(["low"]);
  });

  it("Learn starts only ready processes and shows others dimmed with their %", () => {
    const sessions = [cap("s1", "a", wm(0.5, true, "Low one")), cap("s2", "a", wm(0.9, true, "Good one"))];
    const processes = learnProcesses("a", sessions);
    expect(processes.map((p) => [p.task, p.ready, p.understood])).toEqual(
      expect.arrayContaining([
        ["Low one", false, 50],
        ["Good one", true, 90],
      ]),
    );
    const [card] = galleryCards([agent("a")], sessions);
    const html = renderToStaticMarkup(createElement(LearnView, { agents: [card], selected: card, processes, unknownAgent: false }));
    expect(html).toContain('data-testid="process-not-ready"');
    expect(html).toContain("Still training · 50% understood");
    expect(html).toContain('href="/teach?agent=a&amp;session=s2"');
    expect(html).not.toContain('href="/teach?agent=a&amp;session=s1"');
  });
});
