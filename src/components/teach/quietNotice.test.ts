import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EMAIL_FLOW_WORKMAP } from "@/lib/teach/fixtures";
import { HttpError, saveOutcomeText, visionFailedText } from "./quietNotice";
import TeachConsole, { type TeachConsoleProps } from "./TeachConsole";

const RAW = /Not saved|\/api\/|\b(404|500|503)\b|Error:/;

afterEach(() => vi.restoreAllMocks());

describe("Teach page failure texts", () => {
  it("save failures (404, 500, 503, network) give a quiet notice, never 'Not saved' or the raw error", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const err of [new HttpError("/api/session/t_1/teach", 404), new HttpError("/api/session/t_1/teach", 500), new HttpError("/api/x", 503), new TypeError("Failed to fetch")]) {
      const { saved, notice } = saveOutcomeText({ kind: "failed", err });
      expect(saved).toBe("");
      expect(notice).toBeTruthy();
      expect(`${saved} ${notice}`).not.toMatch(RAW);
    }
    expect(saveOutcomeText({ kind: "failed", err: new HttpError("/api/x", 503) }).notice).toContain("not switched on yet");
    expect(warn).toHaveBeenCalled();
    expect(saveOutcomeText({ kind: "saved" })).toEqual({ saved: "Saved to this teach session.", notice: null });
    expect(saveOutcomeText({ kind: "sample" }).saved).not.toMatch(RAW);
  });

  it("vision failures name the daily limit on 429 and otherwise stay quiet", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(visionFailedText(new HttpError("/api/vision", 429))).toContain("Daily vision limit");
    expect(visionFailedText(new HttpError("/api/vision", 500))).not.toMatch(RAW);
  });

  it("the mastery summary after a failed save renders no raw error and no empty saved line", () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { saved, notice } = saveOutcomeText({ kind: "failed", err: new HttpError("/api/session/t_1/teach", 404) });
    const props = {
      options: [],
      selected: "cap_1",
      workmap: EMAIL_FLOW_WORKMAP,
      banner: null,
      workmapSessionId: "cap_1",
      running: false,
      starting: false,
      paused: false,
      sharing: false,
      shareWarning: null,
      notice,
      textMode: false,
      companion: { status: "paired", permissions: { input: true, screen: true, accessibility: true }, onPair: () => true },
      currentStep: null,
      transcript: [],
      intervention: null,
      replayOpen: false,
      stats: { interventions: 0, active: 0, decideCalls: 0, decideFailures: 0, lastDecideError: null, capped: false },
      result: { mastered: [], practice: [], text: "", saved },
      onSelect: () => {},
      onStart: () => {},
      onToggleShare: () => {},
      onTogglePause: () => {},
      onEnd: () => {},
      onReplay: () => {},
      onAnswer: () => {},
    } as unknown as TeachConsoleProps;
    const html = renderToStaticMarkup(createElement(TeachConsole, props));
    expect(html).toContain("could not be stored this time");
    expect(html).not.toMatch(RAW);
  });

  it("TeachApp never builds a 'Not saved' text or interpolates an error message", () => {
    const src = readFileSync(path.join(__dirname, "TeachApp.tsx"), "utf8");
    expect(src).not.toContain("Not saved");
    expect(src).not.toMatch(/err(or)?\.message|String\(err\)/);
  });
});
