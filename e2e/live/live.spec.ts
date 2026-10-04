// Live hands-on flow against the deployed app, one step per test (docs/checks/e2e-live.md). Steps run in order on one
// signed-in page; a failed step does not stop the rest. Everything the run creates starts with 'E2E ' and step 13 removes it.
import type { Locator, Page } from "@playwright/test";
import { AGENT_NAME, PREFIX, WORKSPACE_NAME } from "./env";
import { appGap, expect, signIn, test } from "./fixtures";
import type { LoadTime } from "./summary-reporter";

let originalWorkspace = "";

const path = (page: Page) => new URL(page.url()).pathname;

/** Ids of agent cards on /agents whose text contains `text`. */
async function agentIds(page: Page, text: string): Promise<{ id: string; label: string }[]> {
  await page.goto("/agents");
  await expect(page.locator('[data-screen="agents-home"]')).toBeVisible();
  await page.waitForLoadState("networkidle").catch(() => {});
  const cards = await page.locator('main a[href^="/agents/"]').evaluateAll((els) =>
    els.map((e) => ({ href: e.getAttribute("href") ?? "", label: (e.textContent ?? "").trim() })),
  );
  const seen = new Set<string>();
  return cards
    .map((c) => ({ id: /^\/agents\/([^/?#]+)$/.exec(c.href)?.[1] ?? "", label: c.label }))
    .filter((c) => c.id && c.id !== "new" && c.label.includes(text) && !seen.has(c.id) && seen.add(c.id));
}

async function agentId(page: Page): Promise<string> {
  const [hit] = await agentIds(page, AGENT_NAME);
  expect(hit, `${AGENT_NAME} exists (step 03)`).toBeTruthy();
  return hit.id;
}

async function openSwitcher(page: Page) {
  await page.getByRole("button", { name: "Switch workspace" }).click();
  await expect(page.getByRole("menu", { name: "Workspaces" })).toBeVisible();
}

async function activeWorkspace(page: Page): Promise<string> {
  await openSwitcher(page);
  const label = (await page.getByRole("menuitemradio", { checked: true }).locator("span.flex-1").textContent()) ?? "";
  await page.keyboard.press("Escape");
  return label.trim();
}

/** The workspace to come back to: the one active before step 07, else the first that is not the E2E one. */
async function homeWorkspace(page: Page): Promise<string> {
  if (originalWorkspace) return originalWorkspace;
  await openSwitcher(page);
  const labels = await page.getByRole("menuitemradio").locator("span.flex-1").allTextContents();
  await page.keyboard.press("Escape");
  return labels.map((l) => l.trim()).find((l) => !l.startsWith(WORKSPACE_NAME)) ?? "";
}

async function switchTo(page: Page, name: string) {
  await openSwitcher(page);
  await page.getByRole("menuitemradio").filter({ hasText: name }).first().click();
  await page.waitForLoadState("load");
  await expect.poll(async () => (await activeWorkspace(page)).includes(name)).toBe(true);
}

test("01 sign in with email and password, walk onboarding", async ({ app: { page, shot } }) => {
  await signIn(page, shot);
  await expect(page).not.toHaveURL(/\/(login|onboarding)/);
  await shot("signed in");
});

test("02 agents home: search, filter tabs, chips", async ({ app: { page, shot } }) => {
  await page.goto("/agents");
  await expect(page.locator('[data-screen="agents-home"]')).toBeVisible();
  await shot("agents home");
  const search = page.getByPlaceholder("Search agents or experts");
  await search.fill("zz no such agent zz");
  await shot("search no match");
  await search.fill("");
  for (const tab of [/^Ready to teach/, /^Training/, /^All/]) {
    await page.getByRole("tab", { name: tab }).click();
    await expect(page.getByRole("tab", { name: tab })).toHaveAttribute("aria-selected", "true");
    await shot(`tab ${tab.source.replace(/\W/g, " ")}`);
  }
  for (const name of ["Teach a new employee", "Open a Work Map", "Invite an expert"]) {
    await page.goto("/agents");
    const chip = page.getByRole("link", { name, exact: true });
    if (!(await chip.count())) {
      appGap(`chip '${name}' not shown on /agents`);
      continue;
    }
    await chip.first().click();
    await expect(page).not.toHaveURL(/\/agents$/);
    await shot(`chip ${name}`);
  }
});

test("03 create agent E2E Pip with role, expert, first task and an avatar change", async ({ app: { page, shot } }) => {
  await page.goto("/agents/new");
  await page.locator("#na-name").fill(AGENT_NAME);
  await page.locator("#na-role").fill("E2E role: clicks every button");
  await page.locator("#na-expert").fill("E2E Expert");
  await page.keyboard.press("Escape");
  await page.locator("#na-first").fill("E2E first task: approve an invoice");
  await shot("new agent form");
  await page.locator("form").getByRole("button", { name: "Continue" }).click();
  await expect(page.locator('[data-step="2"]')).toBeVisible();
  await shot("studio");
  for (const n of ["star", "robot", "Accent #E76F51"]) {
    const b = page.getByRole("button", { name: n, exact: true });
    if (!(await b.count())) continue;
    await b.click();
    await expect(b).toHaveAttribute("aria-pressed", "true");
  }
  await page.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Saved" })).toBeVisible();
  await shot("avatar saved");
  const id = await agentId(page);
  await page.goto(`/agents/${id}`);
  await expect(page.getByText(AGENT_NAME).first()).toBeVisible();
  await shot("agent page");
});

test("04 agent tabs: processes, shortcuts, guardrails, learners, settings", async ({ app: { page, shot } }) => {
  const id = await agentId(page);
  await page.goto(`/agents/${id}`);
  for (const tab of ["Processes", "Shortcuts", "Guardrails", "Learners", "Settings"]) {
    const t = page.getByRole("tab", { name: new RegExp(`^${tab}`) });
    await t.click();
    await expect(t).toHaveAttribute("aria-selected", "true");
    await page.waitForLoadState("networkidle").catch(() => {});
    await shot(`tab ${tab}`);
  }
});

type SettingsSnapshot = { selects: Record<string, string>; switches: Record<string, string>; texts: Record<string, string> };
const SELECTS = ["At most one question every", "Voice", "Voice speed", "Keep screen moments for"];
const SWITCHES = ["Ask about guardrails first", "Learn keyboard shortcuts", "Redact names and email addresses", "Redact IBANs and phone numbers"];
const TEXTS: [string, (p: Page) => Locator][] = [
  ["Role", (p) => p.locator("#set-role")],
  ["Expert", (p) => p.locator("#set-expert")],
  ["Off the record phrase", (p) => p.getByLabel("Off the record phrase", { exact: true })],
];

async function snapshot(page: Page): Promise<SettingsSnapshot> {
  const s: SettingsSnapshot = { selects: {}, switches: {}, texts: {} };
  for (const l of SELECTS) s.selects[l] = await page.getByLabel(l, { exact: true }).inputValue();
  for (const l of SWITCHES) s.switches[l] = (await page.getByRole("button", { name: l, exact: true }).getAttribute("aria-pressed")) ?? "";
  for (const [l, loc] of TEXTS) s.texts[l] = await loc(page).inputValue();
  return s;
}

const saved = (page: Page) =>
  page.waitForResponse((r) => r.url().includes("/api/agents/") && r.request().method() !== "GET", { timeout: 10_000 }).catch(() => null);

async function apply(page: Page, target: SettingsSnapshot, from: SettingsSnapshot) {
  for (const l of SELECTS) {
    const el = page.getByLabel(l, { exact: true });
    if (target.selects[l] === from.selects[l] || (await el.isDisabled())) continue;
    const done = saved(page);
    await el.selectOption(target.selects[l]);
    await done;
  }
  for (const l of SWITCHES) {
    const el = page.getByRole("button", { name: l, exact: true });
    if (target.switches[l] === from.switches[l] || (await el.isDisabled())) continue;
    const done = saved(page);
    await el.click();
    await done;
  }
  for (const [l, loc] of TEXTS) {
    const el = loc(page);
    if (target.texts[l] === from.texts[l] || (await el.isDisabled())) continue;
    const done = saved(page);
    await el.fill(target.texts[l]);
    await el.press("Tab");
    await done;
  }
}

test("05 agent settings: change each, persists after reload, then reset", async ({ app: { page, shot } }) => {
  const id = await agentId(page);
  await page.goto(`/agents/${id}?tab=settings`);
  await expect(page.locator("#set-name")).toHaveValue(AGENT_NAME);
  await page.waitForLoadState("networkidle").catch(() => {});
  const before = await snapshot(page);
  await shot("settings before");
  const changed: SettingsSnapshot = { selects: {}, switches: {}, texts: {} };
  for (const l of SELECTS) {
    const values = await page.getByLabel(l, { exact: true }).locator("option").evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
    changed.selects[l] = values.find((v) => v !== before.selects[l]) ?? before.selects[l];
  }
  for (const l of SWITCHES) changed.switches[l] = before.switches[l] === "true" ? "false" : "true";
  changed.texts = { Role: "E2E role changed", Expert: "E2E Expert changed", "Off the record phrase": "e2e pause please" };
  await apply(page, changed, before);
  await shot("settings changed");
  await page.reload();
  await expect(page.locator("#set-name")).toHaveValue(AGENT_NAME);
  await page.waitForLoadState("networkidle").catch(() => {});
  const after = await snapshot(page);
  await shot("settings after reload");
  const disabled: string[] = [];
  for (const l of [...SELECTS, ...SWITCHES]) {
    const el = SELECTS.includes(l) ? page.getByLabel(l, { exact: true }) : page.getByRole("button", { name: l, exact: true });
    if (await el.isDisabled()) disabled.push(l);
  }
  if (disabled.length) appGap(`settings disabled for this user, not checked: ${disabled.join(", ")}`);
  const expected = structuredClone(changed);
  for (const l of disabled) {
    if (l in expected.selects) expected.selects[l] = before.selects[l];
    if (l in expected.switches) expected.switches[l] = before.switches[l];
  }
  expect.soft(after, "every setting persisted after reload").toEqual(expected);
  await apply(page, before, after);
  await page.reload();
  await expect(page.locator("#set-name")).toHaveValue(AGENT_NAME);
  await page.waitForLoadState("networkidle").catch(() => {});
  expect(await snapshot(page), "settings reset to what they were").toEqual(before);
  await shot("settings reset");
});

test("06 workspace: rename and back, invite at example.com and revoke", async ({ app: { page, shot } }) => {
  await page.goto("/workspace");
  await expect(page.getByText("Members", { exact: true }).first()).toBeVisible();
  await shot("workspace");
  const rename = page.getByRole("button", { name: /rename/i }).or(page.getByLabel(/workspace name/i));
  if (await rename.count()) {
    appGap("a rename control exists but this suite does not drive it yet; extend step 06");
  } else appGap("no way to rename a workspace in the app (no control on /workspace or in the switcher)");
  const address = `e2e-${Date.now()}@example.com`;
  await page.locator("#invite-email").fill(address);
  await page.getByRole("button", { name: "Invite", exact: true }).click();
  const row = page.locator("li, tr").filter({ hasText: address });
  await expect(row.first()).toBeVisible();
  await shot("invite pending");
  await row.first().getByRole("button", { name: "Revoke" }).click();
  await expect(row).toHaveCount(0);
  await shot("invite revoked");
});

test("07 workspace: create E2E Workspace, switch to it and back", async ({ app: { page, shot } }) => {
  await page.goto("/agents");
  originalWorkspace = await activeWorkspace(page);
  await openSwitcher(page);
  await shot("switcher");
  if (!(await page.getByRole("menuitemradio").filter({ hasText: WORKSPACE_NAME }).count())) {
    await page.getByRole("menuitem", { name: "Create workspace" }).click();
    const dialog = page.getByRole("dialog", { name: "Create workspace" });
    await dialog.getByLabel("Name").fill(WORKSPACE_NAME);
    await shot("create workspace");
    await dialog.getByRole("button", { name: "Create" }).click();
    await expect(dialog).toBeHidden();
    await page.waitForLoadState("load");
  } else await page.keyboard.press("Escape");
  await switchTo(page, WORKSPACE_NAME);
  await shot("in E2E Workspace");
  await switchTo(page, originalWorkspace);
  await shot("back in original workspace");
});

test("08 command palette (⌘K) search", async ({ app: { page, shot } }) => {
  await page.goto("/agents");
  await page.keyboard.press("ControlOrMeta+k");
  const dialog = page.getByRole("dialog", { name: "Command palette" });
  if (!(await dialog.isVisible())) await page.getByRole("button", { name: "Search", exact: true }).first().click();
  await expect(dialog).toBeVisible();
  await page.getByRole("combobox", { name: /Search agents/ }).fill("E2E");
  await expect(dialog.getByRole("option").first().or(dialog.getByText("No matches in this workspace."))).toBeVisible();
  await shot("palette results");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
});

test("09 Work Map list and a Work Map if any exists", async ({ app: { page, shot } }) => {
  await page.goto("/map");
  await page.waitForLoadState("networkidle").catch(() => {});
  await shot("work maps");
  const first = page.locator('main a[href^="/map/"]').first();
  if (!(await first.count())) {
    test.info().annotations.push({ type: "note", description: "no Work Map in this workspace" });
    return;
  }
  await first.click();
  await expect(page).toHaveURL(/\/map\/[^/]+$/);
  await page.waitForLoadState("networkidle").catch(() => {});
  await shot("work map");
});

test("10 Learn page", async ({ app: { page, shot } }) => {
  await page.goto("/learn");
  // The loading skeleton is a status region, the page brings the one <main> (T-0257).
  await expect(page.getByRole("heading", { name: "Learn", level: 1 })).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await page.waitForLoadState("networkidle").catch(() => {});
  await shot("learn");
});

test("11 Capture and Teach in the browser show the desktop-app notice", async ({ app: { page, shot } }) => {
  await page.goto("/capture");
  await expect(page.getByRole("heading", { name: "Get the desktop app" })).toBeVisible();
  await shot("capture");
  await page.goto("/teach");
  await expect(page.getByText(/desktop app/i).first()).toBeVisible();
  await shot("teach");
});

test("12 user menu: theme toggle, account, sign out and sign in again", async ({ app: { page, shot } }) => {
  await page.goto("/agents");
  const html = page.locator("html");
  const menu = page.getByRole("menu", { name: "User menu" });
  // The Theme group: menuitemradio Dark / Light / System (ThemeToggle).
  const choice = (name: string) => menu.getByRole("group", { name: "Theme" }).getByRole("menuitemradio", { name, exact: true });
  const openMenu = async () => {
    if (!(await menu.isVisible())) await page.getByLabel("Open user menu").click();
    await expect(menu).toBeVisible();
  };
  await openMenu();
  await shot("user menu");
  const checked = (await menu.getByRole("group", { name: "Theme" }).getByRole("menuitemradio", { checked: true }).textContent())?.trim() ?? "System";
  const next = (await html.getAttribute("data-theme")) === "dark" ? "Light" : "Dark";
  await choice(next).click();
  await expect(choice(next)).toHaveAttribute("aria-checked", "true");
  await expect(html).toHaveAttribute("data-theme", next.toLowerCase());
  await shot("theme toggled");
  await openMenu();
  await choice(checked).click();
  await expect(choice(checked)).toHaveAttribute("aria-checked", "true");
  if (!(await page.getByRole("menuitem", { name: "Account and workspace" }).isVisible())) await page.getByLabel("Open user menu").click();
  await page.getByRole("menuitem", { name: "Account and workspace" }).click();
  await expect(page).toHaveURL(/\/workspace$/);
  await shot("account");
  await page.getByLabel("Open user menu").click();
  await page.getByRole("menuitem", { name: "Sign out" }).click();
  await expect.poll(() => path(page)).not.toBe("/workspace");
  await shot("signed out");
  await page.goto("/agents");
  await expect(page).toHaveURL(/\/login/);
  await signIn(page, shot);
  await expect(page).not.toHaveURL(/\/login/);
  await shot("signed in again");
});

test(`13 clean up: delete ${AGENT_NAME}, other '${PREFIX.trim()}' agents and ${WORKSPACE_NAME}`, async ({ app: { page, shot } }) => {
  await page.goto("/agents");
  const home = await homeWorkspace(page);
  if (home && (await activeWorkspace(page)) !== home) await switchTo(page, home);
  const agents = await agentIds(page, PREFIX);
  for (const { id } of agents) {
    await page.goto(`/agents/${id}?tab=settings`);
    const name = await page.locator("#set-name").inputValue();
    if (!name.startsWith(PREFIX)) continue;
    await page.getByRole("button", { name: "Delete agent" }).click();
    await page.getByLabel("Agent name", { exact: true }).fill(name);
    await shot(`delete ${name}`);
    await page.getByRole("button", { name: `Delete ${name}`, exact: true }).click();
    await expect(page).toHaveURL(/\/agents$/);
  }
  expect(await agentIds(page, PREFIX), `no '${PREFIX.trim()}' agents left`).toEqual([]);
  await shot("agents cleaned");
  await openSwitcher(page);
  const hasWorkspace = await page.getByRole("menuitemradio").filter({ hasText: WORKSPACE_NAME }).count();
  await page.keyboard.press("Escape");
  if (!hasWorkspace) return;
  await switchTo(page, WORKSPACE_NAME);
  await page.goto("/workspace");
  const del = page.getByRole("button", { name: /delete workspace/i });
  if (await del.count()) {
    await del.first().click();
    await shot("workspace deleted");
  } else {
    appGap(`no way to delete a workspace in the app; '${WORKSPACE_NAME}' is left behind, remove it in Supabase`);
  }
  if (home) await switchTo(page, home);
});

test("14 page load times (navigation timing)", async ({ app: { page, shot } }, testInfo) => {
  const loads: LoadTime[] = [];
  for (const p of ["/agents", "/learn", "/map", "/workspace", "/capture"]) {
    await page.goto(p, { waitUntil: "load" });
    const t = await page.evaluate(() => {
      const n = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
      return n ? { ttfbMs: n.responseStart - n.startTime, domContentLoadedMs: n.domContentLoadedEventEnd - n.startTime, loadMs: n.loadEventEnd - n.startTime } : null;
    });
    if (t) loads.push({ path: p, ttfbMs: Math.round(t.ttfbMs), domContentLoadedMs: Math.round(t.domContentLoadedMs), loadMs: Math.round(t.loadMs) });
    await shot(`load ${p}`);
  }
  await testInfo.attach("load-times", { body: JSON.stringify(loads), contentType: "application/json" });
  expect(loads.length).toBeGreaterThan(0);
});
