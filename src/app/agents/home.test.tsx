// Agents home (Gallery.dc.html): greeting, the input box (search and start), gallery cards and the empty state.
// Extends agents.page.test.tsx (gallery view model and legacy copy), it does not replace it.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AgentGallery from "@/components/agents/AgentGallery";
import AgentsHome from "@/components/agents/AgentsHome";
import { AGENT_A, AGENT_B, SESSIONS } from "@/components/agents/fixtures";
import { filterCards, galleryCards, initials, lastText } from "@/components/agents/model";
import { greeting, HOME_PLACEHOLDER, HOME_RESULT_CAP, homeAction, homeIndex, NO_MATCH_TEXT, searchHome } from "@/lib/agents/home";

const root = fileURLToPath(new URL("../../..", import.meta.url));
const index = homeIndex([AGENT_A, AGENT_B], SESSIONS);
const cards = galleryCards([AGENT_A, AGENT_B], SESSIONS);
const render = (props: Partial<Parameters<typeof AgentsHome>[0]> = {}) =>
  renderToStaticMarkup(<AgentsHome greeting="Good afternoon, Sabine" cards={cards} canCreate index={index} {...props} />);

describe("agents home", () => {
  it("shows the greeting and the input box with the canvas copy", () => {
    const html = render();
    expect(html).toContain("Good afternoon, Sabine");
    expect(html).toContain(`placeholder="${HOME_PLACEHOLDER}"`);
    expect(HOME_PLACEHOLDER).toBe("Ask how something is done, or start a session");
    expect(html).toContain("Ask an agent or start a session");
  });

  it("greets by Zurich time and the email's first name", () => {
    expect(greeting(new Date("2026-10-04T12:30:00Z"), "sabine.keller@example.com")).toBe("Good afternoon, Sabine");
    expect(greeting(new Date("2026-10-04T06:00:00Z"), null)).toBe("Good morning");
    expect(greeting(new Date("2026-10-04T19:00:00Z"), "x1@example.com")).toBe("Good evening");
  });

  it("a question returns matching Work Map steps and guardrails from confirmed maps only", () => {
    const hits = searchHome("discount", index);
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({ agentName: "Senior Sales Person", task: "Send a quote", step: "1. Open the quote template", href: "/map/cap-1#step-1" });
    expect(hits[0].guardrails).toEqual([{ rule: "Never discount above 15%", kind: "limit" }]);
    // cap-2 is an unconfirmed draft with the same steps: never indexed.
    expect(index.every((e) => !e.href.includes("cap-2"))).toBe(true);
    const html = render({ initialQuery: "quote template" });
    expect(html).toContain('data-testid="home-results"');
    expect(html).toContain("1. Open the quote template");
    expect(html).toContain("Never discount above 15%");
    expect(html).toContain('href="/map/cap-1#step-1"');
  });

  it("empty query shows nothing, no match says so, results are capped", () => {
    expect(homeAction("  ", index, "agent-a")).toEqual({ kind: "none" });
    expect(homeAction("payroll", index, "agent-a")).toEqual({ kind: "search", results: [], message: NO_MATCH_TEXT });
    expect(render({ initialQuery: "payroll" })).toContain(NO_MATCH_TEXT);
    expect(render()).not.toContain('data-testid="home-results"');
    const many = Array.from({ length: 20 }, () => index[0]);
    expect(searchHome("send", many)).toHaveLength(HOME_RESULT_CAP);
  });

  it("'start a session' routes to Capture with the selected agent (first card by default)", () => {
    expect(homeAction("start a session", index, "agent-a")).toEqual({ kind: "start", href: "/capture?agent=agent-a" });
    const html = render();
    // Presentational: Start is the '+' button in the box (aria-label), no longer a text button.
    expect(html).toMatch(/<a[^>]*href="\/capture\?agent=agent-b"[^>]*aria-label="Start a session"[^>]*data-testid="home-start"/);
    expect(cards[0].id).toBe("agent-b");
  });

  it("no Start for viewers or with zero agents", () => {
    expect(render({ canCreate: false })).not.toContain("Start a session");
    expect(homeAction("start a session", index, null).kind).toBe("search");
    const empty = render({ cards: [], index: [] });
    expect(empty).not.toContain('data-testid="home-start"');
    expect(empty).toContain("Create an agent first");
  });

  it("gallery cards carry the canvas elements", () => {
    const html = render();
    expect(html).toContain("Each one learns from one expert");
    for (const t of ["Senior Sales Person", "learns from</span> Sabine", "Processes", "Shortcuts", "Guardrails", "Learners"]) expect(html).toContain(t);
    expect(html).toContain("Name it, give it a face, then train it on real work.");
    expect(html).toContain('href="/agents/agent-a"');
  });

  it("empty state matches GalleryEmpty.dc.html", () => {
    const html = render({ cards: [], index: [] });
    for (const t of ["No agents yet", "Start with the person whose know-how you would miss most if they left tomorrow.", "Create your first agent", "Install the companion", "Name it", "Give it a face", "Train it"]) {
      expect(html).toContain(t);
    }
    expect(render({ cards: [], index: [], canCreate: false })).not.toContain("Create your first agent");
  });
});

describe("agents home F2 (Gallery.dc.html 1:1)", () => {
  const count = (html: string, needle: string) => html.split(needle).length - 1;

  it("input box controls: plus (start), agent picker pill, mic and round send", () => {
    const html = render();
    expect(html).toContain('data-testid="home-start"');
    expect(html).toContain('data-testid="home-agent-picker"');
    expect(html).toMatch(/data-testid="home-agent-picker"[^]*AP Clerk[^]*<select aria-label="Agent"/);
    expect(html).toContain('aria-label="Speak"');
    expect(html).toMatch(/<button type="submit" aria-label="Send"/);
    const viewer = render({ canCreate: false });
    expect(viewer).not.toContain('data-testid="home-start"');
    expect(viewer).toContain('aria-label="Send"');
  });

  it("chip row routes to Capture, Learn, Work Maps and the workspace", () => {
    const chips = render().split('data-testid="home-chips"')[1].split("</nav>")[0];
    expect(chips).toMatch(/href="\/capture\?agent=agent-b"[^]*Train AP Clerk/);
    expect(chips).toMatch(/href="\/learn\?agent=agent-b"[^]*Teach a new employee/);
    expect(chips).toMatch(/href="\/map"[^]*Open a Work Map/);
    expect(chips).toMatch(/href="\/workspace"[^]*Invite an expert/);
    expect(render({ canCreate: false })).not.toContain("Train AP Clerk");
  });

  it("search filters cards by name, role or expert", () => {
    expect(filterCards(cards, "sabine", "all").map((c) => c.id)).toEqual(["agent-a"]);
    expect(filterCards(cards, "invoices", "all").map((c) => c.id)).toEqual(["agent-b"]);
    expect(filterCards(cards, "  ", "all")).toHaveLength(2);
    const html = renderToStaticMarkup(<AgentGallery cards={cards} canCreate initialSearch="sabine" />);
    expect(html).toContain('placeholder="Search agents or experts"');
    expect(count(html, 'data-testid="agent-card"')).toBe(1);
    expect(html).toContain('href="/agents/agent-a"');
    expect(html).not.toContain('href="/agents/agent-b"');
    expect(renderToStaticMarkup(<AgentGallery cards={cards} canCreate initialSearch="payroll" />)).toContain("No agent matches that search.");
  });

  it("filter tabs count Ready to teach (a confirmed Work Map) and Training", () => {
    const html = renderToStaticMarkup(<AgentGallery cards={cards} canCreate />);
    expect(html).toContain(">All 2</button>");
    expect(html).toContain(">Ready to teach 1</button>");
    expect(html).toContain(">Training 1</button>");
    expect(filterCards(cards, "", "ready").map((c) => c.id)).toEqual(["agent-a"]);
    expect(filterCards(cards, "", "training").map((c) => c.id)).toEqual(["agent-b"]);
    const training = renderToStaticMarkup(<AgentGallery cards={cards} canCreate initialFilter="training" />);
    expect(count(training, 'data-testid="agent-card"')).toBe(1);
    expect(training).toContain('href="/agents/agent-b"');
  });

  it("cards carry status, last trained, expert initials and mono stats", () => {
    const a = cards.find((c) => c.id === "agent-a")!;
    expect(a).toMatchObject({ ready: true, expertName: "Sabine", initials: "S", last: "Trained 2026-10-03" });
    expect(initials("Sabine Keller")).toBe("SK");
    expect(initials(null)).toBe("?");
    expect(lastText(null)).toBe("Not trained yet");
    const html = render();
    expect(html).toContain("Ready to teach</span>");
    expect(html).toContain("Training</span>");
    expect(html).toContain("Trained 2026-10-03");
    expect(html).toContain('class="ui-t3 ui-mono"');
  });

  it("'+ New agent' button and dashed card for creators only", () => {
    const html = render();
    expect(html).toMatch(/href="\/agents\/new"[^>]*data-testid="new-agent-button"/);
    expect(html).toMatch(/data-testid="new-agent-card"[^>]*ui-card-dashed/);
    const viewer = render({ canCreate: false });
    expect(viewer).not.toContain("new-agent-button");
    expect(viewer).not.toContain("new-agent-card");
  });

  it("docs/checks/design-visual-agents.md lists the compare pair and data-only differences", () => {
    const doc = readFileSync(join(root, "docs/checks/design-visual-agents.md"), "utf8");
    expect(doc).toContain("docs/design/compare/agents-app.png");
    expect(doc).toContain("docs/design/compare/agents-canvas.png");
    expect(doc).toContain("## Remaining differences (data only)");
    for (const f of ["agents-app.png", "agents-canvas.png"]) expect(readFileSync(join(root, "docs/design/compare", f)).length).toBeGreaterThan(1000);
  });
});

describe("design fidelity", () => {
  const files = [
    "src/components/agents/AgentsHome.tsx",
    "src/components/agents/AgentGallery.tsx",
    "src/components/landing/Landing.tsx",
    "src/app/login/page.tsx",
    "src/app/login/LoginForm.tsx",
    "src/components/agents/NewAgentFlow.tsx",
    "src/app/workspace/WorkspaceClient.tsx",
  ];
  it("no hex colours in the rebuilt screens (tokens only)", () => {
    for (const f of files) expect([f, readFileSync(join(root, f), "utf8").match(/#[0-9a-fA-F]{6}\b/g)]).toEqual([f, null]);
  });

  it("docs/checks/design-control-room-a.md lists every canvas file in scope with route, component and compare notes", () => {
    const doc = readFileSync(join(root, "docs/checks/design-control-room-a.md"), "utf8");
    const scope = ["Main", "LandingLight", "LandingPhone", "Login", "LoginSent", "Gallery", "GalleryEmpty", "GalleryLight", "GalleryPhone", "NewAgent", "NewAgent2", "NewAgent3", "Studio", "Workspace"];
    for (const f of scope) {
      const row = doc.split("\n").find((l) => l.startsWith(`| \`${f}.dc.html\` |`));
      expect(row, f).toBeDefined();
      const cells = row!.split("|").map((c) => c.trim());
      expect(cells.slice(2, 5).every((c) => c.length > 2), f).toBe(true);
    }
    expect(doc).toMatch(/\| `Pairing\.dc\.html` \|[^\n]*\*\*obsolete\*\*/);
  });
});
