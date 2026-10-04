// Design V3 render tests: each screen's key elements as read from docs/design/canvas/*.dc.html
// (Agent*, WorkMap, Debrief, Learn, Capture, Teach, TeachSummary). Values below are copied from the canvas files.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import AgentDetail, { type AgentDetailProps } from "@/components/agents/AgentDetail";
import { AGENT_A, CREATED_BY, MEMBERS, SESSIONS } from "@/components/agents/fixtures";
import LearnView from "@/components/agents/LearnView";
import { agentGuardrails, agentLearners, agentProcesses, agentShortcuts, learnAgents, learnProcesses, type AgentTab } from "@/components/agents/model";
import CaptureConsole from "@/components/capture/CaptureConsole";
import ScoreBars from "@/components/debrief/ScoreBars";
import TeachBackPanel from "@/components/debrief/TeachBackPanel";
import TeachConsole, { type TeachConsoleProps } from "@/components/teach/TeachConsole";
import { agentStats } from "@/lib/agents/stats";
import { EMAIL_FLOW_WORKMAP } from "@/lib/teach/fixtures";
import WorkMapViewer, { QUOTE_FONT } from "./WorkMapViewer";

// the settings tab renders AgentSettings, which reads the app router
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));

const canvas = (f: string) => readFileSync(join(process.cwd(), "docs/design/canvas", f), "utf8");
const noop = () => {};

describe("canvas values the tests rely on", () => {
  it("threshold line at 75% and the quote font are what the canvas says", () => {
    expect(canvas("WorkMap.dc.html")).toContain("Line marks 75%");
    expect(canvas("Teach.dc.html")).toContain(".bar b{position:absolute;left:75%");
    expect(canvas("Teach.dc.html")).toContain("font-family: 'Instrument Serif', Georgia, serif; font-style: italic");
    expect(QUOTE_FONT).toBe("'Instrument Serif', Georgia, serif");
  });
});

describe("agent page tabs (Agent.dc.html and tab artboards)", () => {
  const props = (tab: AgentTab): AgentDetailProps => ({
    agent: AGENT_A,
    role: "owner",
    tab,
    stats: agentStats(AGENT_A.id, SESSIONS),
    processes: agentProcesses(AGENT_A.id, SESSIONS),
    shortcuts: agentShortcuts(AGENT_A.id, SESSIONS),
    guardrails: agentGuardrails(AGENT_A.id, SESSIONS),
    learners: agentLearners(AGENT_A.id, SESSIONS, MEMBERS, CREATED_BY),
  });
  const render = (tab: AgentTab) => renderToStaticMarkup(<AgentDetail {...props(tab)} />);

  it("hero and tabs", () => {
    const html = render("processes");
    for (const s of ['class="ui-td"', ">Train<", "Teach a new employee", 'role="tablist"', 'class="ui-tab ui-on"', "processes", "guardrails"]) expect(html).toContain(s);
    expect(html).toContain("Open map");
    expect(html).toContain("background:var(--stage)");
  });
  it("shortcuts: chord keycaps and the why column", () => {
    const html = render("shortcuts");
    expect(html).toContain('aria-label="Shortcuts"');
    expect(html).toContain("What it does");
    expect(html).toMatch(/Why, in .*words/);
  });
  it("guardrails: kind filter badges, rule, serif quote, screen moment", () => {
    const html = render("guardrails");
    for (const s of ["All 1", "Limit ", "Exception ", "Stop and ask ", "Screen moment", "Instrument Serif"]) expect(html).toContain(s);
  });
  it("learners: table with mastery bar", () => {
    const html = render("learners");
    for (const s of ['aria-label="Learners"', "Mastery is per step.", "Last session", 'class="ui-bar block"']) expect(html).toContain(s);
  });
  it("settings tab renders the settings card", () => {
    expect(render("settings")).toContain('aria-selected="true" href="/agents/agent-a?tab=settings"');
  });
});

describe("Work Map viewer (WorkMap.dc.html, WorkMapLight.dc.html)", () => {
  const html = renderToStaticMarkup(<WorkMapViewer sessionId="cap_1" workmap={EMAIL_FLOW_WORKMAP} initial={2} />);
  it("step selection: tabs per step, the chosen one selected", () => {
    expect(html).toContain('role="tablist" aria-label="Steps"');
    expect((html.match(/role="tab"/g) ?? []).length).toBe(EMAIL_FLOW_WORKMAP.steps.length);
    expect(html).toMatch(/aria-selected="true" data-step="3"/);
    expect(html).toContain(`Step 3 of ${EMAIL_FLOW_WORKMAP.steps.length}`);
    expect(html).toContain("Click a step to see the screen moment and the reason");
  });
  it("reason quote in italic serif", () => {
    expect(html).toMatch(/data-testid="reason-quote"[^>]*font-family:&#x27;Instrument Serif&#x27;, Georgia, serif;font-style:italic/);
  });
  it("score bars with the 75% threshold", () => {
    expect(html).toContain("Knows why");
    expect(html).toContain("Knows when to stop");
    expect((html.match(/<b style="left:75%"><\/b>/g) ?? []).length).toBe(2);
    expect(html).toContain("Line marks 75%");
    for (const s of ["Decision", "Guardrails", "Understanding", "Previous step", "Next step"]) expect(html).toContain(s);
  });
});

describe("debrief (Debrief.dc.html)", () => {
  it("understanding per step: before/gained bars, legend, 75% line, below note", () => {
    const history = [
      { steps: [{ n: 1, reason_captured: 0.4, guardrail_captured: 0.5 }] },
      { steps: [{ n: 1, reason_captured: 0.7, guardrail_captured: 0.9 }] },
    ] as Parameters<typeof ScoreBars>[0]["history"];
    const html = renderToStaticMarkup(<ScoreBars history={history} titles={{ 1: "Open the mail" }} />);
    for (const s of ["Understanding per step", "Rises as you answer. The line marks 75%, the bar to clear.", "Before debrief", "Gained now", "Below 75%", "1 step still below 75%."]) expect(html).toContain(s);
    expect(html).toContain('<b style="left:75%"></b>');
    expect(html).toContain("+30");
  });
  it("teach-back card copy", () => {
    const html = renderToStaticMarkup(<TeachBackPanel text="Here is how I understood it." corrected={false} confirmed={false} busy={false} awaitingCorrection={false} onResult={noop} />);
    for (const s of ["Teach-back", "Yes, that is how it works", "Not quite", "lets you say what is wrong", "ui-btn ui-bp ui-bl"]) expect(html).toContain(s);
  });
});

describe("learn (Learn.dc.html)", () => {
  it("three steps: Agent, Process, Start", () => {
    const agents = learnAgents([AGENT_A], SESSIONS);
    const html = renderToStaticMarkup(<LearnView agents={agents} selected={agents[0]} processes={learnProcesses(AGENT_A.id, SESSIONS)} unknownAgent={false} />);
    for (const s of [">Learn</h1>", ">Agent<", ">Process<", ">Start<", "Pick an agent, then a process.", "teaches", "border:5px solid var(--ac)"]) expect(html).toContain(s);
  });
});

describe("capture console (Capture.dc.html, without the pairing card)", () => {
  it("key elements and no pairing digits", () => {
    const html = renderToStaticMarkup(
      <CaptureConsole
        running
        starting={false}
        offRecord={false}
        sharing
        shareWarning={null}
        expert="Sabine"
        lastQuestion="What made you do that?"
        asked={3}
        guardrailAsked={1}
        savedForDebrief={0}
        feed={[]}
        companion={{ status: "paired", permissions: { input: true, screen: true, accessibility: true }, onPair: () => true }}
        host="bridge"
        onExpertChange={noop}
        onStart={noop}
        onEnd={noop}
        onTogglePause={noop}
        onToggleShare={noop}
      />,
    );
    for (const s of ["Last question", "Live events", "Newest first · personal data is redacted before it is stored", "Questions so far", "1 about guardrails", "Share entire screen", ">Sharing<", "Capturing", "Running in AI Apprentice", 'aria-label="Capture controls"'])
      expect(html).toContain(s);
    expect(html).not.toContain("Pairing digit");
    expect(html).not.toContain('data-testid="companion-card"');
  });
});

describe("teach console (Teach.dc.html, TeachSummary.dc.html)", () => {
  const base: TeachConsoleProps = {
    options: [],
    selected: null,
    workmap: EMAIL_FLOW_WORKMAP,
    banner: null,
    workmapSessionId: null,
    running: true,
    starting: false,
    paused: false,
    sharing: false,
    shareWarning: null,
    notice: null,
    textMode: false,
    companion: { status: "paired", permissions: null, onPair: () => true },
    host: "bridge",
    currentStep: EMAIL_FLOW_WORKMAP.steps[0],
    transcript: [],
    intervention: null,
    replayOpen: false,
    stats: { interventions: 0, active: 0, decideCalls: 0, decideFailures: 0, lastDecideError: null, capped: false },
    result: null,
    onSelect: noop,
    onStart: noop,
    onToggleShare: noop,
    onTogglePause: noop,
    onEnd: noop,
    onReplay: noop,
    onAnswer: noop,
  };
  it("live: header badge, current step card with progress segments, transcript, app status", () => {
    const html = renderToStaticMarkup(<TeachConsole {...base} />);
    for (const s of ["Teaching on your screen", "Current step · 1 of", "Tutor transcript", "On your screen now", "Running in AI Apprentice", "background:var(--ac)"]) expect(html).toContain(s);
    expect((html.match(/height:6px;border-radius:3px;flex:1/g) ?? []).length).toBe(EMAIL_FLOW_WORKMAP.steps.length);
  });
  it("summary: mastered and practice next cards", () => {
    const html = renderToStaticMarkup(
      <TeachConsole {...base} running={false} result={{ mastered: [EMAIL_FLOW_WORKMAP.steps[0].title], practice: [], text: "", saved: "Saved." }} />,
    );
    for (const s of ["Session complete", `Nice work. 1 of ${EMAIL_FLOW_WORKMAP.steps.length} steps mastered.`, ">Mastered<", ">Practice next<", "Off the record time is not part of it."]) expect(html).toContain(s);
  });
});
