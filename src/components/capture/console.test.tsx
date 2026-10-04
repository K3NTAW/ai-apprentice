import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ScreenEvent } from "@/lib/types";
import CaptureConsole, { type CaptureConsoleProps } from "./CaptureConsole";
import CompanionCard, { COMPANION_README, missingPermissions } from "./CompanionCard";
import { desktopDownloads, GetDesktopApp } from "./DesktopPanel";
import { captureFixture as f } from "@/lib/fixtures/capture";

const noop = () => {};
const ev: ScreenEvent = {
  id: "e1",
  t: 65,
  source: "os",
  type: "app_switched",
  entity: { kind: "app", id: "Microsoft Outlook" },
  app: "Microsoft Outlook",
};

function props(over: Partial<CaptureConsoleProps> = {}): CaptureConsoleProps {
  return {
    running: true,
    starting: false,
    offRecord: false,
    sharing: false,
    shareWarning: null,
    expert: "Sabine",
    lastQuestion: "Why this step?",
    asked: 2,
    guardrailAsked: 1,
    savedForDebrief: 0,
    feed: [ev],
    companion: { status: "not connected", permissions: null, onPair: () => true },
    onExpertChange: noop,
    onStart: noop,
    onEnd: noop,
    onTogglePause: noop,
    onToggleShare: noop,
    ...over,
  };
}

describe("capture console", () => {
  it("renders Start, Share screen, End task, Pause, the feed, counter and last question, and no ERP markup", () => {
    const html = renderToStaticMarkup(<CaptureConsole {...props()} />);
    // presentational (design visual F1): Pause and Off the record are separate buttons as in the canvas
    for (const label of [">Start<", ">Share screen<", ">End task<", ">Pause<", ">Off the record<"]) expect(html).toContain(label);
    // presentational (design V3): the counter is the big number plus "asked · 1 about guardrails"
    expect(html).toMatch(/>2<\/span>.*asked · .*1 about guardrails/);
    expect(html).toContain("Why this step?");
    // presentational (design V3): the feed row puts the time and the text in separate columns
    expect(html).toContain(">01:05<");
    expect(html).toContain("switched to Microsoft Outlook");
    expect(html).toContain("whole screen");
    expect(html).toContain('data-testid="screen-preview"');
    // presentational (design V3): no pairing card, the app status shows instead
    expect(html).not.toContain('data-testid="companion-card"');
    expect(html).toContain('data-testid="app-status"');
    expect(html).not.toMatch(/ERP|erp|invoice/);
  });

  it("two columns as in Capture.dc.html: header, last question with quote and chips, events table, tiles, app card", () => {
    const html = renderToStaticMarkup(
      <CaptureConsole
        {...props({
          expert: f.expert,
          agentName: f.agentName,
          task: f.task,
          elapsed: f.elapsed,
          lastQuestion: f.lastQuestion,
          askedAt: f.askedAt,
          lastAnswer: f.lastAnswer,
          answerChips: f.answerChips,
          asked: f.asked,
          guardrails: f.guardrails,
          nextQuestionIn: f.nextQuestionIn,
          feed: f.feed,
          host: "bridge",
          companion: { status: "paired", permissions: f.permissions, onPair: () => false },
        })}
      />,
    );
    expect(html).toContain("Agents / Pip / Train");
    expect(html).toContain(">Training Pip<");
    expect(html).toMatch(/Capturing · <span class="ui-mono">12:48<\/span>/);
    expect(html).toContain("Task: Code incoming supplier invoices · Sabine Keller");
    // left: last question, the answer in the serif quote box, the chips
    expect(html).toMatch(/data-testid="last-answer".*Sabine · 6 s.*class="ui-qs"[^>]*>Equipment over/);
    expect(html).toContain('class="ui-bdg ui-k-lim">Saved as guardrail · Limit<');
    expect(html).toContain('class="ui-bdg ui-k-jc">Judgment call · step 4<');
    expect(html).toContain("Asked at a pause, after Enter in Excel · 14:05:14");
    // live events: newest first, coloured app tag, keycaps for shortcuts
    const rows = html.split('class="ui-ev"').slice(1);
    expect(rows).toHaveLength(f.feed.length);
    expect(rows[0]).toContain("Google Chrome");
    expect(html).toContain('<i style="background:#3FCF8E"></i>Microsoft Excel');
    expect(html).toMatch(/<span class="ui-kc">⌘<\/span><span class="ui-kc">⇧<\/span><span class="ui-kc">L<\/span>/);
    // right: questions so far with the three tiles and the next-question line
    expect(html).toMatch(/>2<\/div><div[^>]*>Steps seen</);
    expect(html).toMatch(/>3<\/div><div[^>]*>Shortcuts</);
    expect(html).toMatch(/>2<\/div><div[^>]*>Guardrails</);
    expect(html).toContain("Next question allowed in ");
    expect(html).toContain(">1:20<");
    // app card: no pairing, 'Running in AI Apprentice', Allowed / Missing + Fix rows
    expect(html).toContain("Running in AI Apprentice");
    expect(html).not.toContain("Pairing");
    expect(html).toMatch(/permission-screen.*Screen Recording.*>Allowed</);
    expect(html).toMatch(/permission-accessibility.*Accessibility.*>Missing<.*>Fix</);
    // the old single-column cards are gone
    expect(html).not.toContain(">Companion<");
    expect(html.indexOf("last-question-card")).toBeLessThan(html.indexOf("question-tiles"));
  });

  it("redacted text shows the striped chip", () => {
    const ev2: ScreenEvent = { ...ev, id: "e2", type: "item_sent", entity: { kind: "email", id: "[name redacted]" } };
    expect(renderToStaticMarkup(<CaptureConsole {...props({ feed: [ev2] })} />)).toContain('class="ui-red"');
  });

  it("shows the not-monitor warning", () => {
    const html = renderToStaticMarkup(<CaptureConsole {...props({ shareWarning: "Halo placement will be off." })} />);
    expect(html).toContain("Halo placement will be off.");
  });
});

describe("companion card", () => {
  const card = (p: Partial<Parameters<typeof CompanionCard>[0]> = {}) =>
    renderToStaticMarkup(<CompanionCard status="not connected" permissions={null} onPair={() => true} {...p} />);

  it("not connected: says not reachable from this browser, offers the code input and the README link", () => {
    const html = card();
    expect(html).toContain("not reachable from this browser");
    expect(html).toContain('aria-label="Pairing code"');
    expect(html).toContain(COMPANION_README);
    expect(COMPANION_README).toContain("companion/README");
  });

  it("pair, origin blocked and paired variants", () => {
    expect(card({ status: "pair" })).toContain("enter the code");
    expect(card({ status: "origin blocked" })).toContain("allowed origins");
    const paired = card({ status: "paired", permissions: { input: true, screen: false, accessibility: false } });
    expect(paired).toContain("Paired");
    expect(paired).not.toContain('aria-label="Pairing code"');
    expect(paired).toContain("Missing macOS permissions: Screen Recording, Accessibility");
    expect(missingPermissions({ input: true, screen: true, accessibility: true })).toEqual([]);
  });
});

describe("sandbox ERP is gone", () => {
  const root = join(process.cwd(), "src");
  const self = relative(root, __filename);
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(name)) files.push(p);
    }
  };
  walk(root);

  it("no file under src/ mentions lib/erp, components/erp or domEvents", () => {
    const needles = ["lib/" + "erp", "components/" + "erp", "dom" + "Events"];
    const hits = files
      .filter((f) => relative(root, f) !== self)
      .filter((f) => needles.some((n) => readFileSync(f, "utf8").includes(n)))
      .map((f) => relative(root, f));
    expect(hits).toEqual([]);
  });
});

describe("desktop app vs browser (one-app D2)", () => {
  it("in the desktop app no pairing card renders, only 'Running in AI Apprentice' with the permission state", () => {
    const html = renderToStaticMarkup(
      <CaptureConsole {...props({ host: "bridge", companion: { status: "paired", permissions: { input: true, screen: false, accessibility: true }, onPair: () => true } })} />,
    );
    expect(html).not.toContain('data-testid="companion-card"');
    expect(html).not.toContain("Pairing code");
    expect(html).toContain("Running in AI Apprentice");
    expect(html).toContain("Missing permissions: Screen Recording");
    expect(html).not.toContain("Get the desktop app");
  });

  it("in a browser the 'Get the desktop app' panel shows on the #companion anchor; links only when set", () => {
    const html = renderToStaticMarkup(<CaptureConsole {...props({ host: "none" })} />);
    expect(html).toContain("Get the desktop app");
    expect(html).toContain('id="companion"');
    expect(html).not.toContain('data-testid="companion-card"');
    expect(html).not.toContain("Download for");
    const links = renderToStaticMarkup(<GetDesktopApp downloads={desktopDownloads({ mac: "https://dl.example/mac.dmg", win: "javascript:alert(1)" })} />);
    expect(links).toContain('href="https://dl.example/mac.dmg"');
    expect(links).not.toContain("Download for Windows");
  });

  it("while detecting (SSR) neither the panel nor the card renders; the WebSocket opt-in keeps the card", () => {
    const detecting = renderToStaticMarkup(<CaptureConsole {...props({ host: "detecting" })} />);
    expect(detecting).not.toContain("Get the desktop app");
    expect(detecting).not.toContain('data-testid="companion-card"');
    expect(renderToStaticMarkup(<CaptureConsole {...props({ host: "websocket" })} />)).toContain('data-testid="companion-card"');
  });
});
