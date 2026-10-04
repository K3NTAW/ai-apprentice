// CI-free script check for the local e2e suite: the script exists, the default config skips the live suite, and the
// pre-PR checks in docs/DEPLOY.md name npm run e2e.
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import config from "../playwright.config";

const read = (rel: string) => fs.readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

describe("e2e script guard", () => {
  it("package.json runs playwright test as npm run e2e", () => {
    expect(JSON.parse(read("../package.json")).scripts.e2e).toBe("playwright test");
  });

  it("the default config ignores e2e/live/**", () => {
    expect(config.testDir).toBe("e2e");
    expect([config.testIgnore].flat()).toContain("live/**");
  });

  it("docs/DEPLOY.md lists npm run e2e in the pre-PR checks", () => {
    const doc = read("../docs/DEPLOY.md");
    const section = doc.slice(doc.indexOf("## Pre-PR checks"), doc.indexOf("\n## ", doc.indexOf("## Pre-PR checks") + 1));
    expect(section).toMatch(/^## Pre-PR checks/);
    expect(section).toContain("npm run e2e");
  });
});
