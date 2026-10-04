// The live suite's onboarding walk (e2e/live/onboarding.ts) against a mocked page that behaves like OnboardingFlow:
// a fresh user is walked through all four steps and the five training cards; an onboarded user is left alone.
import type { Page } from "@playwright/test";
import { describe, expect, it } from "vitest";
import { ONBOARDING_AGENT } from "./live/env";
import { walkOnboarding } from "./live/onboarding";

const STEPS = ["workspace", "permissions", "agent", "training"] as const;

function mockPage(start: { path: string; step?: (typeof STEPS)[number]; card?: number }) {
  const s = { path: start.path, step: start.step ?? "workspace", card: start.card ?? 1, agent: false, filled: {} as Record<string, string> };
  const log: string[] = [];
  const on = () => s.path === "/onboarding";
  const advance = () => {
    const i = STEPS.indexOf(s.step);
    if (i === STEPS.length - 1) s.path = "/agents";
    else s.step = STEPS[i + 1];
  };
  const buttons: Record<string, () => boolean> = {
    Continue: () => on() && s.step !== "training" && (s.step !== "agent" || s.agent),
    "Skip for now": () => on() && s.step !== "training",
    Next: () => on() && s.step === "training" && s.card < 5,
    Later: () => on() && s.step === "training" && s.card === 5,
  };
  const press: Record<string, () => void> = { Continue: advance, "Skip for now": advance, Next: () => (s.card += 1), Later: advance };
  const fail = (what: string) => {
    throw new Error(`mock: ${what} not on the page (step ${s.step}, card ${s.card})`);
  };
  const button = (name: string) => ({
    isVisible: async () => buttons[name]?.() ?? false,
    isEnabled: async () => buttons[name]?.() ?? false,
    click: async () => {
      if (!buttons[name]?.()) fail(`button ${name}`);
      log.push(name);
      press[name]();
    },
  });
  const visible: Record<string, () => boolean> = {
    '[data-screen="onboarding"]': on,
    "#na-name": () => on() && s.step === "agent" && !s.agent,
    "#na-role": () => on() && s.step === "agent" && !s.agent,
    '[data-step="2"]': () => on() && s.step === "agent" && s.agent,
    '[data-testid="walkthrough"]': () => on() && s.step === "training",
  };
  const locator = (sel: string) => ({
    isVisible: async () => visible[sel]?.() ?? false,
    waitFor: async () => {
      if (!visible[sel]?.()) fail(sel);
    },
    getAttribute: async (name: string) => {
      if (!visible[sel]?.()) fail(sel);
      return name === "data-step" ? s.step : name === "data-card" ? String(s.card) : null;
    },
    fill: async (value: string) => {
      if (!visible[sel]?.()) fail(sel);
      s.filled[sel] = value;
    },
    getByRole: (_role: string, { name }: { name: string }) => ({
      click: async () => {
        if (sel !== "form" || name !== "Continue" || !visible["#na-name"]()) fail(`form ${name}`);
        log.push("create agent");
        s.agent = true;
      },
    }),
  });
  const page = {
    url: () => `https://app.example.com${s.path}`,
    locator,
    getByRole: (_role: string, { name }: { name: string }) => button(name),
  } as unknown as Page;
  return { page, s, log };
}

describe("e2e:live onboarding walk", () => {
  it("completes onboarding for a fresh user: workspace, permissions, first agent, five training cards", async () => {
    const { page, s, log } = mockPage({ path: "/onboarding" });
    const shots: string[] = [];
    const walked = await walkOnboarding(page, async (n) => void shots.push(n), 500);
    expect(walked).toEqual(["workspace", "permissions", "agent", "training"]);
    expect(log).toEqual(["Continue", "Skip for now", "create agent", "Continue", "Next", "Next", "Next", "Next", "Later"]);
    expect(s.filled["#na-name"]).toBe(ONBOARDING_AGENT);
    expect(ONBOARDING_AGENT.startsWith("E2E ")).toBe(true);
    expect(s.path).toBe("/agents");
    expect(shots).toContain("onboarding training card 5");
  });

  it("is a no-op for a user who finished onboarding", async () => {
    const { page, log } = mockPage({ path: "/agents" });
    expect(await walkOnboarding(page, async () => {}, 500)).toEqual([]);
    expect(log).toEqual([]);
  });

  it("resumes where the user left off (training, third card)", async () => {
    const { page, s, log } = mockPage({ path: "/onboarding", step: "training", card: 3 });
    expect(await walkOnboarding(page, async () => {}, 500)).toEqual(["training"]);
    expect(log).toEqual(["Next", "Next", "Later"]);
    expect(s.path).toBe("/agents");
  });
});
