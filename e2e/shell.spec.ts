import { expect, test, type Locator } from "@playwright/test";
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

// T-0257 (live run 2026-10-04): the Create workspace dialog sat behind the agent cards, the user menu was clipped by
// the sidebar, /learn showed two <main>s while it streamed. /preview/shell is the Supabase-mode sidebar over cards.
test.describe("shell layers: menus and dialog above the page, not clipped", () => {
  /** Fully inside the viewport and the topmost element at its centre (not covered by cards or clipped). */
  async function expectReachable(locator: Locator) {
    await expect(locator).toBeInViewport({ ratio: 1 });
    await locator.click({ trial: true });
  }

  for (const size of [
    { width: 1440, height: 900 },
    { width: 800, height: 560 },
  ]) {
    test(`Create workspace dialog at ${size.width}x${size.height}: above the cards, every control reachable`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/preview/shell");
      await page.getByRole("button", { name: "Switch workspace" }).click();
      const menu = page.getByRole("menu", { name: "Workspaces" });
      await expect(menu).toBeVisible();
      await expectReachable(menu.getByRole("menuitemradio", { name: /Sales/ }));
      await menu.getByRole("menuitem", { name: "Create workspace" }).click();
      const dialog = page.getByRole("dialog", { name: "Create workspace" });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByLabel("Name")).toBeFocused();
      await dialog.getByLabel("Name").fill("E2E Workspace");
      await dialog.getByLabel("City (optional)").fill("Zug");
      for (const name of ["Create", "Cancel"]) await expectReachable(dialog.getByRole("button", { name, exact: true }));
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await expect(dialog).toHaveCount(0);
    });
  }

  for (const size of [
    { width: 1440, height: 900 },
    { width: 390, height: 844 },
  ]) {
    test(`user menu at ${size.width}x${size.height}: not clipped, sidebar stays put`, async ({ page }) => {
      await page.setViewportSize(size);
      await page.goto("/preview/shell");
      const logo = page.getByRole("link", { name: "AI Apprentice home" });
      const before = await logo.boundingBox();
      await page.getByRole("button", { name: "Open user menu" }).click();
      const menu = page.getByRole("menu", { name: "User menu" });
      await expect(menu).toBeVisible();
      await expect(menu).toBeInViewport({ ratio: 1 });
      for (const name of ["Dark", "Light", "System"]) await expectReachable(menu.getByRole("menuitemradio", { name }));
      await expectReachable(menu.getByRole("menuitem", { name: "Sign out" }));
      await expect(logo).toBeVisible();
      expect(await logo.boundingBox()).toEqual(before);
      await menu.getByRole("menuitemradio", { name: "System" }).click();
      await expect(menu.getByRole("menuitemradio", { name: "System" })).toHaveAttribute("aria-checked", "true");
    });
  }

  test("the sidebar edge runs the full height of a long page", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto("/preview/shell");
    const height = await page.evaluate(() => document.documentElement.scrollHeight);
    expect(height).toBeGreaterThan(900);
    expect((await page.locator("[data-sidebar-column]").boundingBox())?.height).toBe(height);
  });
});

test("/learn renders its content with exactly one <main> and no stuck skeleton", async ({ page }) => {
  await page.goto("/learn");
  await expect(page.getByRole("heading", { name: "Learn", level: 1 })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.getByRole("status").filter({ hasText: /Loading/ })).toHaveCount(0);
});
