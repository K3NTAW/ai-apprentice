import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ScreenEvent } from "@/lib/types";
import CaptureConsole, { type CaptureConsoleProps } from "./CaptureConsole";
import CompanionCard, { COMPANION_README, missingPermissions } from "./CompanionCard";

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
    for (const label of [">Start<", ">Share screen<", ">End task<", "Pause / off the record"]) expect(html).toContain(label);
    expect(html).toContain("2 asked, 1 about guardrails");
    expect(html).toContain("Why this step?");
    expect(html).toContain("01:05 switched to Microsoft Outlook");
    expect(html).toContain("whole screen");
    expect(html).toContain('data-testid="companion-card"');
    expect(html).not.toMatch(/ERP|erp|invoice/);
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
