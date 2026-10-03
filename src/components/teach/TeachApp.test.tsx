import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EMAIL_FLOW_WORKMAP } from "@/lib/teach/fixtures";
import type { Intervention } from "@/lib/teach/intervention";
import TeachConsole, { decideStatus, frameUrl, type TeachConsoleProps } from "./TeachConsole";

const step = EMAIL_FLOW_WORKMAP.steps[2];
const iv: Intervention = {
  id: "iv_1",
  key: "3|cost_code|4711",
  step,
  guardrail: step.guardrails[0],
  expert: "Sabine",
  say: "Sabine would stop here. Why do you think?",
  quote: step.guardrails[0].quote!,
  replay: { t: 48, frame_ref: "frames/sabine-48.jpg", quote: step.guardrails[0].quote! },
  halo: true,
  notice: null,
  source: "rule",
  probability: 1,
  pending: { step_n: 3, entity: "cell row 14", field: "cost_code", to: "4711" },
};

const base: TeachConsoleProps = {
  options: [{ id: "cap_1", label: "Sabine · 2026-10-03 21:00 · Code incoming purchase requests" }],
  selected: "cap_1",
  workmap: EMAIL_FLOW_WORKMAP,
  banner: null,
  workmapSessionId: "cap_1",
  running: true,
  starting: false,
  paused: false,
  sharing: true,
  shareWarning: null,
  notice: null,
  textMode: false,
  companion: { status: "paired", permissions: { input: true, screen: true, accessibility: true }, onPair: () => true },
  currentStep: step,
  transcript: [{ id: "l1", speaker: "tutor", text: "What would you do next?" }],
  intervention: iv,
  replayOpen: true,
  stats: { interventions: 1, active: 1, decideCalls: 0, decideFailures: 0, lastDecideError: null, capped: false },
  result: null,
  onSelect: () => {},
  onStart: () => {},
  onToggleShare: () => {},
  onTogglePause: () => {},
  onEnd: () => {},
  onReplay: () => {},
  onAnswer: () => {},
};

describe("Teach console", () => {
  it("shows the step, the tutor transcript, the stop and the expert's moment; no placeholder, no sandbox", () => {
    const html = renderToStaticMarkup(<TeachConsole {...base} />);
    expect(html).toContain("Step 3: Set the cost code");
    expect(html).toContain("What would you do next?");
    expect(html).toContain("Sabine would stop here. Why do you think?");
    expect(html).toContain("Replay Sabine&#x27;s moment");
    expect(html).toContain('src="/api/session/cap_1/frames/sabine-48.jpg"');
    expect(html).toContain('data-testid="companion-card"');
    expect(html).not.toContain("being rebuilt");
    expect(html).not.toMatch(/\bERP\b|invoice/);
  });

  it("says voice only when the companion is not paired and shows mastery at the end", () => {
    const html = renderToStaticMarkup(
      <TeachConsole
        {...base}
        intervention={null}
        companion={{ ...base.companion, status: "pair" }}
        result={{ mastered: ["Open the purchase request email"], practice: ["Set the cost code"], text: "", saved: "Saved to this teach session." }}
      />,
    );
    expect(html).toContain("Companion not paired: the tutor stops by voice only");
    expect(html).toContain("Mastered");
    expect(html).toContain("Practice next");
    expect(html).toContain("Set the cost code");
  });

  it("frame urls only for stored frames; decide failures are visible", () => {
    expect(frameUrl("cap_1", "../secret")).toBeNull();
    expect(frameUrl(null, "frames/a.jpg")).toBeNull();
    expect(decideStatus({ ...base.stats, decideFailures: 2, lastDecideError: "decide timeout" })).toContain("2 failed (decide timeout)");
    expect(decideStatus({ ...base.stats, capped: true })).toContain("usage cap reached");
  });
});

describe("Teach console in the desktop app vs a browser (one-app D2)", () => {
  it("desktop app: no pairing card and no 'not paired' note", () => {
    const html = renderToStaticMarkup(<TeachConsole {...base} host="bridge" />);
    expect(html).not.toContain('data-testid="companion-card"');
    expect(html).toContain("Running in AI Apprentice");
    expect(html).not.toContain("Companion not paired");
  });

  it("browser: the 'Get the desktop app' panel", () => {
    const html = renderToStaticMarkup(<TeachConsole {...base} host="none" companion={{ ...base.companion, status: "not connected" }} />);
    expect(html).toContain("Get the desktop app");
    expect(html).not.toContain('data-testid="companion-card"');
  });
});
