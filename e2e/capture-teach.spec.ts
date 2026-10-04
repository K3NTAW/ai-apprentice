import { expect, test } from "@playwright/test";
import { expectCovered } from "./coverage";
import { AGENT_A, MAP_SESSION, SHELL } from "./fixtures";

test.describe("learn", () => {
  test("agent, then process, then start", async ({ page }) => {
    await page.goto("/learn");
    await expectCovered(page, { ...SHELL, "/^Invoice Ivy/": "url" });
    await page.getByRole("link", { name: /^Invoice Ivy/ }).click();
    await expect(page).toHaveURL(new RegExp(`/learn\\?agent=${AGENT_A}$`));
    await expect(page.locator("main:not([aria-busy])").getByText("Approve supplier invoices").first()).toBeVisible();
    const items = await expectCovered(page, { ...SHELL, "/^Invoice Ivy/": "url", "/./": "url" }, "main:not([aria-busy])");
    console.log("learn controls", JSON.stringify(items.map((i) => `${i.name} ->${i.href}`)));
    await page.locator(`main:not([aria-busy]) a[href*="/teach"]`).first().click();
    await expect(page).toHaveURL(/\/teach\?/);
  });
});

test.describe("capture console in the browser", () => {
  test("start, pause, off the record, end", async ({ page }) => {
    await page.goto(`/capture?agent=${AGENT_A}`);
    await expectCovered(page, { ...SHELL, Start: "state", Pause: "disabled", "Off the record": "disabled", "End task": "disabled", "Share screen": "disabled" });
    for (const n of ["Pause", "Off the record", "End task", "Share screen"]) await expect(page.getByRole("button", { name: n })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Get the desktop app" }).first()).toBeVisible();
    await expect(page.getByText("Loading the agent.")).toHaveCount(0);
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByRole("button", { name: "End task" })).toBeEnabled();
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("button", { name: /Resume/ })).toBeVisible();
    await page.getByRole("button", { name: /Resume/ }).click();
    await page.getByRole("button", { name: "Off the record" }).click();
    await expect(page.getByText(/off the record/i).nth(1)).toBeVisible();
    await page.getByRole("button", { name: /off the record|back on the record|resume recording/i }).first().click();
    await page.getByRole("button", { name: "End task" }).click();
    await expect(page).toHaveURL(/\/(debrief|map)\//);
  });
});

test.describe("teach console", () => {
  test("start, chat input, summary", async ({ page }) => {
    await page.goto(`/teach?session=${MAP_SESSION}`);
    await expectCovered(page, { ...SHELL, "Learn / Teach": "url", Start: "state", "Share screen": "disabled", Pause: "disabled", Finish: "disabled" });
    await page.getByRole("button", { name: "Start", exact: true }).click();
    await expect(page.getByText(/Text mode: the tutor writes here/)).toBeVisible();
    const input = page.getByRole("textbox").last();
    await input.fill("I open the invoice first");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByText("I open the invoice first").first()).toBeVisible();
    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByRole("button", { name: /Resume/ })).toBeVisible();
    await page.getByRole("button", { name: /Resume/ }).click();
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(page.getByText(/Mastered/i).first()).toBeVisible();
    await expect(page.getByText(/Practice next/i).first()).toBeVisible();
  });
});
