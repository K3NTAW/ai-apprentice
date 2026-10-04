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
    // Home redirects to /agents in local mode (app/page.tsx).
    ["AI Apprentice home", /\/agents$/],
  ] as const) {
    test(`${name} navigates`, async ({ page }) => {
      await page.goto("/map");
      await page.getByRole("link", { name, exact: true }).first().click();
      await expect(page).toHaveURL(url);
    });
  }

  test("recent sessions link to teach and the map", async ({ page }) => {
    await page.goto("/learn");
    await page.locator(`[aria-label="Recent sessions"] a[href="/teach?session=${TEACH_SESSION}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/teach\\?session=${TEACH_SESSION}$`));
    await page.goto("/learn");
    await page.locator(`[aria-label="Recent sessions"] a[href="/map/${MAP_SESSION}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/map/${MAP_SESSION}$`));
  });

  test("user menu: theme toggles, account opens the workspace", async ({ page }) => {
    await page.goto("/map");
    const html = page.locator("html");
    const toggle = page.getByRole("button", { name: "Open user menu" });
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "true");
    const menu = page.getByRole("menu", { name: "User menu" });
    await expect(menu).toBeVisible();
    const next = (await html.getAttribute("data-theme")) === "dark" ? "Light" : "Dark";
    await menu.getByRole("menuitemradio", { name: next }).click();
    await expect(menu.getByRole("menuitemradio", { name: next })).toHaveAttribute("aria-checked", "true");
    await expect(html).toHaveAttribute("data-theme", next.toLowerCase());
    if (!(await menu.isVisible())) await toggle.click();
    await menu.getByRole("menuitem", { name: "Account and workspace" }).click();
    await expect(page).toHaveURL(/\/workspace$/);
  });

  test("collapse toggles the sidebar, search opens the palette", async ({ page }) => {
    await page.goto("/map");
    await page.getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(page.getByRole("button", { name: "Expand sidebar" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Expand sidebar" }).click();
    await expect(page.getByRole("button", { name: "Collapse sidebar" })).toHaveAttribute("aria-pressed", "false");
    await page.getByRole("button", { name: "Search" }).click();
    await expect(page.getByRole("dialog", { name: "Command palette" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog", { name: "Command palette" })).toHaveCount(0);
  });
});
