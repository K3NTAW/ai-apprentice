// README.md names only npm scripts that exist, and carries no secret values.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const root = path.resolve(__dirname, "../..");
const readme = readFileSync(path.join(root, "README.md"), "utf8");
const scriptsOf = (dir: string): Record<string, string> =>
  JSON.parse(readFileSync(path.join(root, dir, "package.json"), "utf8")).scripts ?? {};

/** Every `npm run x`, `npm test` and `npm --prefix dir run x` in the README, with the package dir it targets. */
function namedScripts(text: string): Array<{ dir: string; name: string }> {
  const out: Array<{ dir: string; name: string }> = [];
  for (const m of text.matchAll(/npm\s+(?:--prefix\s+(\S+)\s+)?(?:run\s+([\w:.-]+)|(test)\b)/g)) {
    out.push({ dir: m[1] ?? ".", name: m[2] ?? m[3] });
  }
  return out;
}

describe("README.md", () => {
  it("names only npm scripts that exist in the matching package.json", () => {
    const named = namedScripts(readme);
    expect(named.length).toBeGreaterThan(5);
    const missing = named.filter(({ dir, name }) => !(name in scriptsOf(dir))).map(({ dir, name }) => `${dir}: ${name}`);
    expect(missing).toEqual([]);
  });

  it("catches a script that does not exist", () => {
    const missing = namedScripts("npm run nope and npm --prefix companion run nope").filter(({ dir, name }) => !(name in scriptsOf(dir)));
    expect(missing).toHaveLength(2);
  });

  it("covers the seven sections", () => {
    for (const h of ["## How it works", "## Architecture", "## Getting started locally", "## Deploy", "## Trust, privacy and limitations", "## Roadmap", "## Team"]) {
      expect(readme).toContain(h);
    }
    expect(readme).toContain("```mermaid");
  });

  it("has no secret values", () => {
    expect(readme).not.toMatch(/sk-[A-Za-z0-9_-]{10,}|eyJ[A-Za-z0-9_-]{10,}|\b[A-Z_]*(KEY|SECRET|PASSWORD|TOKEN)[A-Z_]*=\S*[A-Za-z0-9]{6,}/);
  });
});
