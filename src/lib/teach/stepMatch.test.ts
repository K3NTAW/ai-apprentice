import { describe, expect, it } from "vitest";
import { EMAIL_FLOW_EVENTS, EMAIL_FLOW_WORKMAP, SLIDE_FLOW_EVENTS, SLIDE_FLOW_WORKMAP } from "./fixtures";
import { matchStep } from "./stepMatch";

describe("matchStep", () => {
  it("matches the email-flow events to their steps by app, object and action", () => {
    const steps = EMAIL_FLOW_EVENTS.map((e) => matchStep(e, EMAIL_FLOW_WORKMAP)?.step.n ?? null);
    expect(steps).toEqual([1, 2, 3, 3, 4]);
    expect(matchStep(EMAIL_FLOW_EVENTS[2], EMAIL_FLOW_WORKMAP)?.confidence).toBeCloseTo(1);
  });

  it("matches the slide-flow events to their steps", () => {
    expect(SLIDE_FLOW_EVENTS.map((e) => matchStep(e, SLIDE_FLOW_WORKMAP)?.step.n ?? null)).toEqual([1, 2, 3]);
  });

  it("returns null when nothing matches, never a default step", () => {
    const ev = { ...EMAIL_FLOW_EVENTS[0], app: "Spotify", entity: { kind: "song", id: "x" }, field: "volume" };
    expect(matchStep(ev, EMAIL_FLOW_WORKMAP)).toBeNull();
    // The app alone is not enough.
    expect(matchStep({ ...ev, app: "Microsoft Excel" }, EMAIL_FLOW_WORKMAP)).toBeNull();
  });

  it("ignores the app's own surfaces", () => {
    expect(matchStep({ ...EMAIL_FLOW_EVENTS[2], window: "AI Apprentice - Teach" }, EMAIL_FLOW_WORKMAP)).toBeNull();
  });

  it("fixtures carry no sandbox content", () => {
    const text = JSON.stringify([EMAIL_FLOW_WORKMAP, SLIDE_FLOW_WORKMAP, EMAIL_FLOW_EVENTS, SLIDE_FLOW_EVENTS]);
    expect(text).not.toMatch(/\bERP\b|invoice|sandbox/i);
  });
});
