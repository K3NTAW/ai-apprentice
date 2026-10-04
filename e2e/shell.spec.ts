import { expect, test } from "@playwright/test";
import { expectCovered } from "./coverage";
import { MAP_SESSION, SHELL, TEACH_SESSION } from "./fixtures";

test.describe("shell: sidebar and user menu", () => {
  test("every shell control has an expectation", async ({ page }) => {
    await page.goto("/map");
    await expect(page.getByRole("link", { name: "Agents", exact: true })).toBeVisible();
    await expectCovered(page, { ...SHELL, "/^Ana Expert/": "url" });
  });

  for (const [name, url] of [
    ["Agents", /\/agents$/],
    ["Learn", /\/learn$/],
    ["Workspace", /\/workspace$/],
    ["Start capture", /\/capture$/],
    ["Get the desktop app", /\/capture#companion$/],
    ["AI Apprentice home", /:\d+\/$/],
  ] as const) {
    test(`${name} navigates`, async ({ page }) => {
      await page.goto("/map");
      await page.getByRole("link", { name, exact: true }).first().click();
      await expect(page).toHaveURL(url);
    });
  }

  test("recent sessions link to teach and the map", async ({ page }) => {
    await page.goto("/learn");
    await page.getByRole("link", { name: /^Teach · Lena Learner/ }).click();
    await expect(page).toHaveURL(new RegExp(`/teach\\?session=${TEACH_SESSION}$`));
    await page.goto("/learn");
    await page.locator(`a[href="/map/${MAP_SESSION}"]`).first().click();
    await expect(page).toHaveURL(new RegExp(`/map/${MAP_SESSION}$`));
  });

  test("user menu: theme toggles, account opens the workspace", async ({ page }) => {
    await page.goto("/map");
    const html = page.locator("html");
    const before = await html.evaluate((el) => el.outerHTML.slice(0, 300));
    const menu = page.locator("details:has([role=menu])").first();
    await menu.locator("summary").click();
    await expect(page.getByRole("menu", { name: "User menu" })).toBeVisible();
    await page.getByRole("menuitem", { name: /theme$/ }).click();
    await expect.poll(() => html.evaluate((el) => el.outerHTML.slice(0, 300))).not.toBe(before);
    if (!(await page.getByRole("menuitem", { name: "Account and workspace" }).isVisible())) await menu.locator("summary").click();
    await page.getByRole("menuitem", { name: "Account and workspace" }).click();
    await expect(page).toHaveURL(/\/workspace$/);
  });
});
