// One signed-in browser page per worker, shared by the steps so the flow reads like a person clicking through.
// If a step fails, Playwright restarts the worker; the next step signs in again (via `app`) and carries on.
// Per step: console errors and failed requests (status >= 400, 401 probes counted apart) go into an `observations`
// attachment that summary-reporter.ts turns into e2e/live/out/summary.md.
import { expect, test as base, type Page } from "@playwright/test";
import fs from "node:fs";
import path from "node:path";
import { creds, ONBOARDING_AGENT, scrub } from "./env";

export const OUT_DIR = path.join("e2e", "live", "out");

type Session = { page: Page; signedIn: boolean };
type App = { page: Page; shot: (name: string) => Promise<void> };
export type Observations = { console: string[]; network: string[]; ignored401: number };

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/** Screenshot with every credential-bearing field masked. */
export async function screenshot(page: Page, file: string) {
  fs.mkdirSync(OUT_DIR, { recursive: true });
  const mask = [page.locator("input[type=password]"), page.locator("input[type=email]"), page.locator("#login-password"), page.locator("#login-email")];
  const { email } = creds();
  if (email) mask.push(page.getByText(email));
  await page.screenshot({ path: path.join(OUT_DIR, file), fullPage: true, mask });
}

/** Walks every onboarding step: workspace (Continue), permissions (skipped, desktop only), first agent, training (Later). */
export async function walkOnboarding(page: Page, shot: (name: string) => Promise<void>) {
  const screen = page.locator('[data-screen="onboarding"]');
  for (let i = 0; i < 6 && new URL(page.url()).pathname.startsWith("/onboarding"); i++) {
    await expect(screen).toBeVisible();
    const step = (await screen.getAttribute("data-step")) ?? "";
    await shot(`onboarding ${step}`);
    if (step === "workspace") await page.getByRole("button", { name: "Continue", exact: true }).click();
    else if (step === "permissions") await page.getByRole("button", { name: "Skip for now" }).click();
    else if (step === "agent") {
      const name = page.locator("#na-name");
      if (await name.isVisible()) {
        await name.fill(ONBOARDING_AGENT);
        await page.locator("#na-role").fill("E2E onboarding agent");
        await page.locator("form").getByRole("button", { name: "Continue" }).click();
        await expect(page.locator('[data-step="2"]')).toBeVisible();
        await shot("onboarding agent created");
        await page.getByRole("button", { name: "Continue", exact: true }).click();
      } else await page.getByRole("button", { name: "Skip for now" }).click();
    } else if (step === "training") await page.getByRole("button", { name: "Later" }).click();
    else break;
    await expect.poll(async () => `${new URL(page.url()).pathname}|${await screen.getAttribute("data-step").catch(() => null)}`).not.toBe(`/onboarding|${step}`);
  }
}

/** Email + password sign-in on /login, then onboarding if the app redirects there. */
export async function signIn(page: Page, shot: (name: string) => Promise<void> = async () => {}) {
  const { email, password } = creds();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await shot("login filled");
  await page.locator("form").getByRole("button", { name: "Sign in" }).click();
  await expect(page).not.toHaveURL(/\/login(\?|$)/, { timeout: 30_000 });
  await page.waitForLoadState("load");
  await walkOnboarding(page, shot);
}

export const test = base.extend<{ app: App }, { session: Session }>({
  session: [
    async ({ browser }, provide) => {
      const context = await browser.newContext({ baseURL: process.env.BASE_URL, viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      page.on("dialog", (d) => void d.accept());
      await provide({ page, signedIn: false });
      await context.close();
    },
    { scope: "worker" },
  ],
  app: async ({ session }, provide, testInfo) => {
    const { page } = session;
    const step = testInfo.title.slice(0, 2);
    let n = 0;
    const shot = async (name: string) => {
      n += 1;
      await screenshot(page, `${step}-${String(n).padStart(2, "0")}-${slug(name)}.png`);
    };
    const obs: Observations = { console: [], network: [], ignored401: 0 };
    const onConsole = (m: { type: () => string; text: () => string }) => {
      if (m.type() === "error") obs.console.push(scrub(m.text()).slice(0, 300));
    };
    const onPageError = (e: Error) => obs.console.push(scrub(`pageerror: ${e.message}`).slice(0, 300));
    const onResponse = (r: { status: () => number; url: () => string; request: () => { method: () => string } }) => {
      const status = r.status();
      if (status < 400) return;
      if (status === 401) obs.ignored401 += 1;
      else obs.network.push(scrub(`${status} ${r.request().method()} ${r.url().split("?")[0]}`));
    };
    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("response", onResponse);
    if (!session.signedIn && !testInfo.title.includes("sign in")) {
      await signIn(page);
      session.signedIn = true;
    }
    try {
      await provide({ page, shot });
      if (testInfo.title.includes("sign in")) session.signedIn = true;
    } finally {
      if (testInfo.status !== testInfo.expectedStatus) await shot("failure").catch(() => {});
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("response", onResponse);
      await testInfo.attach("observations", { body: JSON.stringify(obs), contentType: "application/json" });
    }
  },
});

/** Records something the app cannot do (or did wrong) in the summary instead of failing the step. */
export function appGap(text: string) {
  test.info().annotations.push({ type: "app-gap", description: text });
}

export { expect };
