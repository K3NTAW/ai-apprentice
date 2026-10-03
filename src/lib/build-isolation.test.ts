import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import vitestConfig from "../../vitest.config";

const root = (file: string) => readFileSync(fileURLToPath(new URL(`../../${file}`, import.meta.url)), "utf8");

// The companion (Electron) has its own deps and configs; the web app's checks must never compile or run it.
describe("root build isolation from companion/", () => {
  it("tsconfig.json excludes companion", () => {
    const tsconfig = JSON.parse(root("tsconfig.json")) as { exclude?: string[] };
    expect(tsconfig.exclude).toContain("companion");
  });

  it("the ESLint config ignores companion/**", () => {
    const globalIgnores = root("eslint.config.mjs").match(/globalIgnores\(\[([\s\S]*?)\]\)/);
    expect(globalIgnores?.[1]).toMatch(/["']companion\/\*\*["']/);
  });

  it("the Vitest config excludes companion/**", () => {
    expect(vitestConfig.test?.exclude).toContain("companion/**");
  });
});
