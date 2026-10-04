import { expect, test } from "@playwright/test";
import { expectCovered } from "./coverage";
import { DEBRIEF_SESSION, MAP_SESSION, SHELL } from "./fixtures";

test.describe("work map list and viewer", () => {
  test("list links to each map", async ({ page }) => {
    await page.goto("/map");
    await expectCovered(page, { ...SHELL, "/^Ana Expert2026/": "url" });
    await page.locator(`main a[href="/map/${MAP_SESSION}"]`).click();
    await expect(page).toHaveURL(new RegExp(`/map/${MAP_SESSION}$`));
  });

  test("timeline selection, previous and next, export, open in teach", async ({ page }) => {
    await page.goto(`/map/${MAP_SESSION}`);
    await expectCovered(page, {
      ...SHELL,
      "All Work Maps / Work Map": "url",
      "Export guardrails": "download",
      "Open in Teach": "url",
      "/^\\d · \\d\\d:\\d\\d/": "state",
      "Previous step": "state",
      "Next step": "state",
    });
    await page.getByRole("tab", { name: /Check the amount/ }).click();
    await expect(page.getByRole("tab", { name: /Check the amount/ })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("STEP 2 OF 3", { exact: false }).or(page.getByText(/step 2 of 3/i)).first()).toBeVisible();
    await page.getByRole("button", { name: "Next step" }).click();
    await expect(page.getByText(/step 3 of 3/i).first()).toBeVisible();
    await page.getByRole("button", { name: "Previous step" }).click();
    await expect(page.getByText(/step 2 of 3/i).first()).toBeVisible();
    const dl = page.waitForEvent("download");
    await page.getByRole("link", { name: "Export guardrails" }).click();
    expect((await dl).suggestedFilename()).not.toBe("");
    await page.getByRole("link", { name: "Open in Teach" }).click();
    await expect(page).toHaveURL(new RegExp(`/teach\\?session=${MAP_SESSION}$`));
    await page.goto(`/map/${MAP_SESSION}`);
    await page.getByRole("link", { name: "All Work Maps / Work Map" }).click();
    await expect(page).toHaveURL(/\/map$/);
  });
});

test.describe("debrief", () => {
  test("start in text mode, teach-back confirm and not quite", async ({ page }) => {
    await page.goto(`/debrief/${DEBRIEF_SESSION}`);
    await expectCovered(page, { ...SHELL, "Work Map / Debrief": "url", "Start debrief": "state", "Text mode": "state" });
    await page.getByRole("button", { name: "Text mode" }).click();
    // Without LLM keys the question queue is empty, so the flow goes straight to the teach-back.
    await expect(page.getByRole("button", { name: "Not quite" })).toBeVisible();
    await expectCovered(page, { ...SHELL, "Work Map / Debrief": "url", "Finish later": "url", "Yes, that is how it works": "state", "Not quite": "state", Send: "state" });
    await page.getByRole("button", { name: "Not quite" }).click();
    await expect(page.getByPlaceholder("What did I get wrong?")).toBeVisible();
    await page.getByRole("button", { name: "Yes, that is how it works" }).click();
    await expect(page.getByText(/confirmed/i).first()).toBeVisible();
  });

  test("finish later returns to the map", async ({ page }) => {
    await page.goto(`/debrief/${DEBRIEF_SESSION}`);
    await page.getByRole("button", { name: "Text mode" }).click();
    await page.getByRole("link", { name: "Finish later" }).click();
    await expect(page).toHaveURL(new RegExp(`/map/${DEBRIEF_SESSION}`));
  });
});
