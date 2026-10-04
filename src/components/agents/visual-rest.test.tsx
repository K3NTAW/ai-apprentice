// Canvas elements closed in the design-visual-rest fix round: new agent fields, guardrail rows, shortcut filters, learn.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ usePathname: () => "/", useRouter: () => ({ push: () => {}, refresh: () => {} }), useSearchParams: () => new URLSearchParams() }));

import { previewAgents } from "@/lib/fixtures/agents";
import { previewSessionsFull } from "@/lib/fixtures/preview";
import AgentDetail, { type AgentDetailProps } from "./AgentDetail";
import LearnView from "./LearnView";
import { agentGuardrails, agentShortcuts, captureHref, learnAgents, learnProcesses, learnTraining, type ShortcutRow } from "./model";
import NewAgentFlow, { expertInitials, memberName } from "./NewAgentFlow";
import ShortcutsTab, { shortcutApps } from "./ShortcutsTab";

describe("new agent: first task and expert picker", () => {
  it("step 1 has the 'First task to learn' textarea and the expert picker with an avatar chip", () => {
    const html = renderToStaticMarkup(<NewAgentFlow experts={[{ label: "sabine.keller@example.com", name: "Sabine Keller" }]} initialFirstTask="Code invoices" />);
    expect(html).toContain("First task to learn");
    expect(html).toMatch(/<textarea[^>]*id="na-first"[^>]*>Code invoices<\/textarea>/);
    expect(html).toContain('data-testid="expert-chip"');
    expect(html).toContain('list="na-experts"');
    expect(html).toContain('value="Sabine Keller · sabine.keller@example.com"');
  });
  it("initials and member names", () => {
    expect(expertInitials("Sabine Keller · sabine.keller@example.com")).toBe("SK");
    expect(expertInitials("marco.bianchi@example.com")).toBe("MB");
    expect(memberName("lena.graf@example.com")).toBe("Lena Graf");
  });
  it("the first task goes to Capture as the task title", () => {
    expect(captureHref("pip", "Code invoices")).toBe("/capture?agent=pip&task=Code%20invoices");
    expect(captureHref("pip")).toBe("/capture?agent=pip");
  });
  it("steps 2-3: step 1 is marked done", () => {
    const html = renderToStaticMarkup(<NewAgentFlow initialAgentId="pip" initialName="Pip" />);
    expect(html).toContain('data-state="done"');
    expect(html).toContain('aria-current="step"');
  });
});

const pip = previewAgents.find((a) => a.id === "pip")!;
const detail = (tab: "guardrails" | "shortcuts", shortcuts: ShortcutRow[] = []) =>
  renderToStaticMarkup(
    <AgentDetail
      {...({
        agent: pip,
        role: "owner",
        tab,
        processes: [],
        shortcuts,
        guardrails: agentGuardrails("pip", previewSessionsFull),
        learners: [],
        stats: { processes: 2, shortcuts: shortcuts.length, guardrails: 9, learners: 0, mastered: null },
      } as unknown as AgentDetailProps)}
    />,
  );

describe("agent tabs", () => {
  it("guardrail rows: serif quote line, status, play icon on 'Screen moment', 'Export guardrails' on the export route", () => {
    const html = detail("guardrails");
    expect(html).toContain('data-testid="guardrail-quote"');
    expect(html).toContain("var(--font-serif)");
    expect(html).toContain("Confirmed");
    expect(html).toContain('data-testid="play-icon"');
    expect(html).toContain("Export guardrails");
    expect(html).toContain("/api/export?session_id=pip-1");
  });
  it("shortcuts: per-app filter chips", () => {
    const rows: ShortcutRow[] = [
      { chord: "Cmd+C", app: "Excel", what: "Copy", why: "", task: "t", href: "/" },
      { chord: "Cmd+V", app: "Excel", what: "Paste", why: "", task: "t", href: "/" },
      { chord: "Cmd+R", app: "Outlook", what: "Reply", why: "", task: "t", href: "/" },
    ];
    expect(shortcutApps(rows)).toEqual([{ app: "Excel", n: 2 }, { app: "Outlook", n: 1 }]);
    const html = renderToStaticMarkup(<ShortcutsTab rows={rows} expert="Sabine" />);
    for (const t of ["All apps", "Excel 2", "Outlook 1", 'aria-label="Filter by app"']) expect(html).toContain(t);
    expect(agentShortcuts("pip", previewSessionsFull)).toEqual([]);
  });
});

describe("learn", () => {
  it("eyebrow, dimmed 'Still training' agents, focus and practice blocks", () => {
    const agents = learnAgents(previewAgents, previewSessionsFull);
    const training = learnTraining(previewAgents, previewSessionsFull);
    expect(training.map((t) => t.id)).toEqual(["nova"]);
    const selected = agents.find((a) => a.id === "pip")!;
    const html = renderToStaticMarkup(
      <LearnView agents={agents} selected={selected} processes={learnProcesses("pip", previewSessionsFull)} unknownAgent={false} training={training} firstName="Lena" />,
    );
    expect(html).toContain("Hi Lena");
    expect(html).toContain('data-testid="still-training"');
    expect(html).toContain("Still training · not ready yet");
    expect(html).not.toContain("/learn?agent=nova");
    expect(html).toContain("Pip will focus on");
    expect(html).toContain("Step 2 · Check for a duplicate");
    expect(html).toContain("Practice with");
    expect(html).toContain("Invoice 4471, Invoice 4502, Invoice 4517, Invoice 4523");
  });
});
