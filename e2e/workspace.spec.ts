import { expect, test } from "@playwright/test";
import { expectCovered } from "./coverage";
import { SHELL } from "./fixtures";

// Local mode has no workspaces (/workspace says so). The owner view is exercised on /workspace/preview with fixture
// members; its actions call the real workspace API, which answers in local mode with an error the page must show.
test.describe("workspace", () => {
  test("local mode says there are no workspaces", async ({ page }) => {
    await page.goto("/workspace");
    await expect(page.getByText("Local mode, no workspaces.")).toBeVisible();
  });

  test("owner view: invite, revoke, role, remove each show a result", async ({ page }) => {
    await page.goto("/workspace/preview");
    await expectCovered(page, { ...SHELL, "Sign out": "url", Remove: "live", expert: "state", learner: "state", Invite: "live", Revoke: "live" });
    await page.getByRole("radio", { name: "expert" }).click();
    await expect(page.getByRole("radio", { name: "expert" })).toHaveAttribute("aria-checked", "true");
    await page.getByLabel(/email/i).first().fill("new.person@example.com");
    for (const action of [
      () => page.getByRole("button", { name: "Invite" }).click(),
      () => page.getByRole("button", { name: "Revoke" }).first().click(),
      () => page.getByRole("button", { name: "Remove" }).first().click(),
    ]) {
      page.once("dialog", (d) => void d.accept());
      await action();
      await expect(page.getByRole("alert")).toBeVisible();
    }
  });
});
