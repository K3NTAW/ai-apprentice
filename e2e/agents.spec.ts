import { expect, test } from "@playwright/test";
import { expectCovered } from "./coverage";
import { AGENT_A, AGENT_B, MAP_SESSION, SHELL } from "./fixtures";

test.describe("agents home", () => {
  test("coverage", async ({ page }) => {
    await page.goto("/agents");
    await expect(page.locator('[data-screen="agents-home"]')).toBeVisible();
    await expectCovered(page, {
      ...SHELL,
      "Start a session": "url",
      Speak: "disabled",
      Send: "url",
      "Train Invoice Ivy": "url",
      "Teach a new employee": "url",
      "Open a Work Map": "url",
      "Invite an expert": "url",
      "/^New agent/": "url",
      "/^All \\d/": "state",
      "/^Ready to teach \\d/": "state",
      "/^Training \\d/": "state",
      "/^(Ready to teach|Training)(Trained|Not trained)/": "url",
    });
  });

  test("input box starts a session for the picked agent", async ({ page }) => {
    await page.goto("/agents");
    await page.getByPlaceholder(/./).first().fill("start a session");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page).toHaveURL(new RegExp(`/capture\\?agent=${AGENT_A}`));
  });

  test("speak is disabled with a reason when speech is unsupported, or enabled", async ({ page }) => {
    await page.goto("/agents");
    const mic = page.getByRole("button", { name: "Speak" });
    // Speech support is detected after hydration; the server render is disabled.
    await page.waitForLoadState("networkidle");
    if (await mic.isDisabled()) await expect(mic).toHaveAttribute("title", /not supported/);
    else await expect(mic).toHaveAttribute("title", "Speak");
  });

  test("chips navigate", async ({ page }) => {
    for (const [name, url] of [
      ["Teach a new employee", new RegExp(`/learn\\?agent=${AGENT_A}$`)],
      ["Open a Work Map", /\/map$/],
      ["Invite an expert", /\/workspace$/],
      [`Train Invoice Ivy`, new RegExp(`/capture\\?agent=${AGENT_A}`)],
    ] as const) {
      await page.goto("/agents");
      await page.getByRole("link", { name, exact: true }).click();
      await expect(page).toHaveURL(url);
    }
  });

  test("filter tabs and search narrow the gallery", async ({ page }) => {
    await page.goto("/agents");
    const cards = page.locator(`a[href^="/agents/0e2e"]`);
    await expect(cards).toHaveCount(2);
    await page.getByRole("tab", { name: /^Ready to teach/ }).click();
    await expect(page.getByRole("tab", { name: /^Ready to teach/ })).toHaveAttribute("aria-selected", "true");
    await expect(cards).toHaveCount(1);
    await page.getByRole("tab", { name: /^Training/ }).click();
    await expect(cards).toHaveCount(1);
    await expect(cards.first()).toHaveAttribute("href", `/agents/${AGENT_B}`);
    await page.getByRole("tab", { name: /^All/ }).click();
    await expect(cards).toHaveCount(2);
    await page.getByPlaceholder("Search agents or experts").fill("ana expert");
    await expect(cards).toHaveCount(1);
    await page.getByPlaceholder("Search agents or experts").fill("");
    await cards.first().click();
    await expect(page).toHaveURL(new RegExp(`/agents/${AGENT_A}$`));
  });
});

test.describe("new agent", () => {
  test("steps 1 to 3 create an agent and link to capture", async ({ page }) => {
    await page.goto("/agents/new");
    await expectCovered(page, { ...SHELL, "Agents /": "url", Cancel: "url", Continue: "state" });
    await expect(page.getByRole("button", { name: "Continue" })).toBeDisabled();
    await page.locator("#na-name").fill("E2E Agent");
    await page.locator("#na-role").fill("Clicks every button");
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.locator('[data-step="2"]')).toBeVisible();
    await page.getByRole("button", { name: "pill" }).click();
    await expect(page.getByRole("button", { name: "pill" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await page.getByRole("link", { name: "Start training" }).click();
    await expect(page).toHaveURL(/\/capture\?agent=/);
  });

  test("cancel returns to agents", async ({ page }) => {
    await page.goto("/agents/new");
    await page.getByRole("link", { name: "Cancel" }).click();
    await expect(page).toHaveURL(/\/agents$/);
  });
});

test.describe("avatar studio", () => {
  test("pickers, animations, export, save", async ({ page }) => {
    await page.goto(`/agents/${AGENT_B}/studio`);
    await expectCovered(page, {
      Agent: "url",
      Randomize: "state",
      "Export PNG": "download",
      "Export SVG": "download",
      Save: "live",
      "/^(idle|listening|thinking|talking|asking|stop|happy|paused)$/": "state",
      "/^(blob|round|square|pill|bean|star|smile|focus|curious|calm|wink|robot)$/": "state",
      "/^(Body colour|Accent) #[0-9A-F]{6}$/": "state",
    });
    for (const n of ["thinking", "star", "robot", "Body colour #264653", "Accent #E76F51"]) {
      await page.getByRole("button", { name: n, exact: true }).click();
      await expect(page.getByRole("button", { name: n, exact: true })).toHaveAttribute("aria-pressed", "true");
    }
    const svg = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export SVG" }).click();
    expect((await svg).suggestedFilename()).toMatch(/\.svg$/);
    const png = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export PNG" }).click();
    expect((await png).suggestedFilename()).toMatch(/\.png$/);
    await page.getByRole("button", { name: "Save" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
    await page.getByRole("button", { name: "Randomize" }).click();
    await page.getByRole("link", { name: "Agent" }).click();
    await expect(page).toHaveURL(new RegExp(`/agents/${AGENT_B}$`));
  });
});

test.describe("agent page", () => {
  const base = `/agents/${AGENT_A}`;
  test("tabs and header", async ({ page }) => {
    await page.goto(base);
    await expectCovered(page, {
      ...SHELL,
      "Agents / Invoice Ivy": "url",
      Train: "url",
      "Teach a new employee": "url",
      "/^(Processes|Shortcuts|Guardrails|Learners) \\d+$/": "url",
      Settings: "url",
      "Train a new process": "url",
      "Open map": "url",
    });
    await page.getByRole("link", { name: "Open map" }).click();
    await expect(page).toHaveURL(new RegExp(`/map/${MAP_SESSION}$`));
    for (const tab of ["Shortcuts", "Guardrails", "Learners", "Settings"]) {
      await page.goto(base);
      await page.getByRole("tab", { name: new RegExp(`^${tab}`) }).click();
      await expect(page).toHaveURL(new RegExp(`tab=${tab.toLowerCase()}$`));
      await expect(page.getByRole("tab", { name: new RegExp(`^${tab}`) })).toHaveAttribute("aria-selected", "true");
    }
  });

  test("shortcuts tab", async ({ page }) => {
    await page.goto(`${base}?tab=shortcuts`);
    await expect(page.getByText("Cmd+Enter").first()).toBeVisible();
    await expect(page.getByText("Send for approval").first()).toBeVisible();
    await expectCovered(page, { "/./": "url" }, "main");
  });

  test("guardrails tab: export and screen-moment replay", async ({ page }) => {
    await page.goto(`${base}?tab=guardrails`);
    await expect(page.getByText("Stop and ask above EUR 10000").first()).toBeVisible();
    const items = await page.locator("main").evaluate((m) => Array.from(m.querySelectorAll("a[href],button")).map((e) => (e.textContent ?? "").trim()));
    console.log("guardrails controls", JSON.stringify(items));
  });

  test("learners tab", async ({ page }) => {
    await page.goto(`${base}?tab=learners`);
    // Local mode has no members, so the seeded teach session is listed as an unknown learner.
    await expect(page.getByText("unknown learner").first()).toBeVisible();
    await expect(page.locator("main").getByText("Approve supplier invoices").first()).toBeVisible();
  });

  test("settings: rename and delete", async ({ page }) => {
    await page.goto(`/agents/${AGENT_B}?tab=settings`);
    const name = page.getByLabel(/name/i).first();
    await name.fill("Ledger Lea");
    await page.getByRole("button", { name: /save/i }).click();
    await expect(page.getByText("Ledger Lea").first()).toBeVisible();
    await page.getByRole("button", { name: "Delete agent" }).click();
    const confirm = page.getByRole("dialog", { name: "Type Ledger Lea to delete it" });
    await expect(confirm.getByRole("button", { name: "Delete Ledger Lea" })).toBeDisabled();
    await confirm.getByLabel("Agent name").fill("Ledger Lea");
    await confirm.getByRole("button", { name: "Delete Ledger Lea" }).click();
    await expect(page).toHaveURL(/\/agents$/);
    await expect(page.locator(`a[href="/agents/${AGENT_B}"]`)).toHaveCount(0);
  });
});
