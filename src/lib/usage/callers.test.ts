// Guard: every src file that calls api.anthropic.com is a metered caller (docs/checks/cost-meter.md). A new caller fails
// here until it reports usage and is added to the list.
import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const SRC = join(process.cwd(), "src");
const METERED = ["src/lib/decide/llm.ts", "src/lib/perception/vision.ts", "src/lib/workmap/synthesize.ts"];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "node_modules" ? [] : files(p);
    return /\.(ts|tsx|js|mjs)$/.test(e.name) && !/\.test\.(ts|tsx)$/.test(e.name) ? [p] : [];
  });
}

describe("model callers carry usage", () => {
  const callers = files(SRC)
    .filter((f) => readFileSync(f, "utf8").includes("api.anthropic.com"))
    .map((f) => relative(process.cwd(), f).split("\\").join("/"))
    .sort();

  it("only the metered files call api.anthropic.com", () => {
    expect(callers).toEqual(METERED);
  });

  it.each(METERED)("%s reads usage from the response", (f) => {
    expect(readFileSync(join(process.cwd(), f), "utf8")).toContain("usage");
  });
});
