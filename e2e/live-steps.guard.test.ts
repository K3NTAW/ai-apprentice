// Guard for steps of the live suite (e2e/live/live.spec.ts) that went stale against the UI (T-0271).
import fs from "node:fs";
import { describe, expect, it } from "vitest";

const spec = fs.readFileSync(new URL("./live/live.spec.ts", import.meta.url), "utf8");
const local = fs.readFileSync(new URL("./shell.spec.ts", import.meta.url), "utf8");

/** The source of one test(...) block, from its title to the next test. */
function step(prefix: string): string {
  const start = spec.search(new RegExp(`test\\(\\s*[\`"]${prefix}`));
  expect(start, `step ${prefix} exists`).toBeGreaterThan(-1);
  const end = spec.indexOf("\ntest(", start + 1);
  return spec.slice(start, end === -1 ? undefined : end);
}

describe("live step 12: theme", () => {
  it("picks a menuitemradio in the user menu's Theme group and checks data-theme changed", () => {
    const s = step("12 ");
    expect(s).toMatch(/getByRole\("group", \{ name: "Theme" \}\)/);
    expect(s).toMatch(/getByRole\("menuitemradio"/);
    expect(s).toMatch(/toHaveAttribute\("data-theme", next\.toLowerCase\(\)\)/);
  });

  it("no longer looks for a '... theme' menuitem, here or in the local e2e", () => {
    for (const text of [spec, local]) expect(text).not.toMatch(/menuitem", \{ name: \/theme\$\//);
  });
});

describe("live steps 07 and 13: workspace switch", () => {
  const helper = spec.slice(spec.indexOf("async function switchTo("), spec.indexOf("\ntest(", spec.indexOf("async function switchTo(")));

  it("waits for POST /api/workspace/active and the reload, then checks the label, again after a reload", () => {
    expect(helper).toMatch(/waitForResponse\(/);
    expect(helper).toContain("/api/workspace/active");
    expect(helper).toMatch(/waitForEvent\("load"\)/);
    expect(helper).toMatch(/page\.reload\(\)/);
    expect(helper).toMatch(/toContainText\(name/);
  });

  it("never polls through the menu (a poll's click closed the still open menu)", () => {
    expect(helper).not.toMatch(/expect\.poll/);
  });
});
