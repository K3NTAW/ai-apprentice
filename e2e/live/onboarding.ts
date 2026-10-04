// Onboarding walk for the live suite, the way a person clicks through it (src/components/onboarding/OnboardingFlow.tsx):
// workspace (Continue), desktop permissions (Skip for now), first agent ('E2E Onboard' when the form shows, else Skip),
// how training works (Next through the five cards, Later on the last). A user who finished onboarding is never on
// /onboarding, so the walk returns at once. Only Page calls a mocked page can answer (e2e/live-onboarding.guard.test.ts).
import type { Page } from "@playwright/test";
import { ONBOARDING_AGENT } from "./env";

type Shot = (name: string) => Promise<void>;

const onOnboarding = (page: Page) => new URL(page.url()).pathname.startsWith("/onboarding");
const button = (page: Page, name: string) => page.getByRole("button", { name, exact: true });

async function until(check: () => Promise<boolean>, timeout: number, what: string) {
  const end = Date.now() + timeout;
  while (!(await check())) {
    if (Date.now() > end) throw new Error(`onboarding: timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
}

async function firstAgent(page: Page, shot: Shot, timeout: number) {
  const name = page.locator("#na-name");
  if (!(await name.isVisible())) return button(page, "Skip for now").click();
  await name.fill(ONBOARDING_AGENT);
  await page.locator("#na-role").fill("E2E onboarding agent");
  await page.locator("form").getByRole("button", { name: "Continue" }).click();
  await page.locator('[data-step="2"]').waitFor({ state: "visible", timeout });
  await shot("onboarding agent created");
  const next = button(page, "Continue");
  await until(async () => next.isEnabled(), timeout, "Continue after the agent was created");
  await next.click();
}

async function training(page: Page, shot: Shot, timeout: number) {
  const cards = page.locator('[data-testid="walkthrough"]');
  await cards.waitFor({ state: "visible", timeout });
  for (let i = 0; i < 10; i++) {
    if (await button(page, "Later").isVisible()) return button(page, "Later").click();
    const card = await cards.getAttribute("data-card");
    await button(page, "Next").click();
    await until(async () => (await cards.getAttribute("data-card")) !== card, timeout, `card ${card} to turn`);
    await shot(`onboarding training card ${Number(card) + 1}`);
  }
  throw new Error("onboarding: no Later button after the training cards");
}

/** Completes onboarding if the page is on it; returns the steps walked (empty when already onboarded). */
export async function walkOnboarding(page: Page, shot: Shot = async () => {}, timeout = 15_000): Promise<string[]> {
  const walked: string[] = [];
  const screen = page.locator('[data-screen="onboarding"]');
  for (let i = 0; i < 8 && onOnboarding(page); i++) {
    await screen.waitFor({ state: "visible", timeout });
    const step = (await screen.getAttribute("data-step")) ?? "";
    walked.push(step);
    await shot(`onboarding ${step}`);
    if (step === "workspace") await button(page, "Continue").click();
    else if (step === "permissions") await button(page, "Skip for now").click();
    else if (step === "agent") await firstAgent(page, shot, timeout);
    else if (step === "training") await training(page, shot, timeout);
    else throw new Error(`onboarding: unknown step '${step}'`);
    await until(
      async () => !onOnboarding(page) || (await screen.getAttribute("data-step", { timeout: 1_000 }).catch(() => null)) !== step,
      timeout,
      `onboarding to leave step ${step}`,
    );
  }
  if (onOnboarding(page)) throw new Error(`onboarding: still on ${new URL(page.url()).pathname} after ${walked.join(", ")}`);
  return walked;
}
