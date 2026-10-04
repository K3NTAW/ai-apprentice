import { expect, test } from "@playwright/test";
import { expectCovered } from "./coverage";

// '/' opens the product (the marketing landing is its own project in marketing/) and login (Login, LoginSent).
// Local mode skips /login (it redirects to /capture), so the sign-in card is exercised on /login/preview; Supabase
// calls fail there and must show an alert.
test.describe("'/' opens the app", () => {
  test("no marketing landing: '/' redirects to /agents (local mode has no sign-in)", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/agents$/);
    await expect(page.locator("[data-screen=landing]")).toHaveCount(0);
  });
});

test.describe("login", () => {
  test("coverage, tabs, show password", async ({ page }) => {
    await page.goto("/login/preview");
    await expectCovered(page, {
      "AI Apprentice": "url",
      "Sign in": "state",
      "Create account": "state",
      Show: "state",
      "Forgot password?": "state",
      "Email me a link": "state",
    });
    await page.getByRole("tab", { name: "Create account" }).click();
    await expect(page.getByRole("tab", { name: "Create account" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel("Confirm password")).toBeVisible();
    await page.getByRole("tab", { name: "Sign in" }).click();
    await expect(page.getByLabel("Confirm password")).toBeHidden();
    await page.getByLabel("Password", { exact: true }).fill("secret-pass");
    await page.getByRole("button", { name: "Show" }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "text");
    await page.getByRole("button", { name: "Hide" }).click();
    await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute("type", "password");
    // NEXT_PUBLIC_MARKETING_URL is unset in e2e: no link to the marketing site.
    await expect(page.getByRole("link", { name: "What is AI Apprentice?" })).toHaveCount(0);
  });

  test("sign in without a backend shows an error", async ({ page }) => {
    await page.goto("/login/preview");
    await page.getByLabel("Email").fill("ana@example.com");
    await page.getByLabel("Password", { exact: true }).fill("secret-pass");
    await page.locator("form").getByRole("button", { name: "Sign in" }).click();
    await expect(page.getByText("That did not work. Try again.")).toBeVisible();
  });

  test("forgot password and magic link reach their forms and show a result", async ({ page }) => {
    await page.goto("/login/preview");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Reset your password" })).toBeVisible();
    await page.getByLabel("Email").fill("ana@example.com");
    await page.getByRole("button", { name: "Email me a reset link" }).click();
    await expect(page.getByText("That did not work. Try again.")).toBeVisible();
    await page.goto("/login/preview");
    await page.getByRole("button", { name: "Email me a link" }).click();
    const submit = page.locator("form button[type=submit]");
    await expect(submit).toBeVisible();
    await page.getByLabel("Email").fill("ana@example.com");
    await submit.click();
    await expect(page.getByText("That did not work. Try again.")).toBeVisible();
  });

  test("link sent state: subject and back", async ({ page }) => {
    await page.goto("/login/preview?sent=ana%40example.com");
    await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
    await expect(page.getByText("ana@example.com")).toBeVisible();
    await expect(page.getByText("Your AI Apprentice sign-in link")).toBeVisible();
    await expectCovered(page, { "AI Apprentice": "url", "Use a different email": "state" });
    await page.locator("[data-screen=login-sent] button").first().click();
    await expect(page.getByLabel("Email")).toBeVisible();
  });
});

test.describe("agents gallery states", () => {
  test("empty: first agent and companion links", async ({ page }) => {
    await page.goto("/agents/preview?empty=1");
    await expect(page.getByRole("heading", { name: "No agents yet" })).toBeVisible();
    const href = await page.getByRole("link", { name: "Install the companion" }).getAttribute("href");
    expect(href).toBeTruthy();
    await page.getByRole("link", { name: "Create your first agent" }).click();
    await expect(page).toHaveURL(/\/agents\/new$/);
  });

  test("phone: top bar, user menu and cards", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/agents");
    await expect(page.getByRole("link", { name: /^Ready to teach.*Invoice Ivy/ })).toBeVisible();
    await page.getByLabel("Open user menu").click();
    await expect(page.getByRole("menu", { name: "User menu" })).toBeVisible();
    await page.getByRole("link", { name: /^Ready to teach.*Invoice Ivy/ }).click();
    await expect(page).toHaveURL(/\/agents\/0e2e/);
  });
});
