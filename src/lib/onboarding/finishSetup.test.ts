// 'Finish setup' only while a required step is open (T-0271): the live e2e user walked onboarding in a browser,
// skipped desktop permissions and still saw the entry.
import { describe, expect, it } from "vitest";
import {
  emptyState,
  finishedRedirect,
  finishSetupVisible,
  markStep,
  ONBOARDING_STEPS,
  REQUIRED_STEPS,
  resumeStep,
  stateFromUser,
  toMetadata,
  type OnboardingStep,
  type StepMark,
} from "./state";

const NOW = "2026-10-04T13:00:00Z";
const NEW_USER = { created_at: "2026-10-04T12:00:00Z" };
const walk = (marks: Partial<Record<OnboardingStep, StepMark>>) =>
  ONBOARDING_STEPS.reduce((s, k) => markStep(s, k, marks[k] ?? "done", NOW), emptyState());

describe("finishSetupVisible", () => {
  it("the browser walk (permissions skipped) is complete and hides 'Finish setup', also read back from user_metadata", () => {
    const s = walk({ permissions: "skipped" });
    expect(s.completedAt).toBe(NOW);
    expect(finishSetupVisible(s)).toBe(false);
    expect(finishSetupVisible(stateFromUser({ ...NEW_USER, user_metadata: toMetadata(s) }))).toBe(false);
  });

  it("skipping the walkthrough does not keep it open either", () => {
    expect(finishSetupVisible(walk({ permissions: "skipped", training: "skipped" }))).toBe(false);
  });

  it("a skipped required step (workspace, first agent) keeps it", () => {
    expect(REQUIRED_STEPS).toEqual(["workspace", "agent"]);
    for (const step of REQUIRED_STEPS) expect(finishSetupVisible(walk({ [step]: "skipped" }))).toBe(true);
  });

  it("not complete keeps it, whatever is marked", () => {
    expect(finishSetupVisible(emptyState())).toBe(true);
    expect(finishSetupVisible(markStep(emptyState(), "workspace", "done", NOW))).toBe(true);
    expect(finishSetupVisible(stateFromUser({ ...NEW_USER, user_metadata: {} }))).toBe(true);
  });

  it("resume goes to the skipped required step before an optional one", () => {
    expect(resumeStep(walk({ permissions: "skipped", agent: "skipped" }))).toBe("agent");
    expect(resumeStep(walk({ permissions: "skipped" }))).toBe("permissions");
  });

  it("an explicit resume link still opens the flow for an optional skipped step; a plain visit does not", () => {
    expect(finishedRedirect(walk({ permissions: "skipped" }), "/agents", true)).toBeNull();
    expect(finishedRedirect(walk({ permissions: "skipped" }), "/agents", false)).toBe("/agents");
  });
});
