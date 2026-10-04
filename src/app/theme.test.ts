// Dark canvas everywhere (design-visual-capture F1): no page, layout or component paints a light content background.
// Light mode comes only from the tokens (data-theme="light" or the OS preference), never from hard-coded classes.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const LIGHT_BG = /\b(?:[a-z]+:)?bg-(?:white|slate-(?:50|100|200|300)|gray-\d+|neutral-(?:50|100|200)|zinc-(?:50|100|200))\b|#F0F3F6/i;

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(tsx|css)$/.test(name) && !/\.test\./.test(name)) out.push(p);
  }
  return out;
}

describe("no light content background in dark mode", () => {
  const src = join(process.cwd(), "src");
  const all = [...files(join(src, "app")), ...files(join(src, "components"))];

  it("no route, layout or component hard-codes a light background class", () => {
    const hits = all
      .filter((f) => f.endsWith(".tsx"))
      .flatMap((f) =>
        readFileSync(f, "utf8")
          .split("\n")
          .map((line, i) => (LIGHT_BG.test(line) ? `${relative(src, f)}:${i + 1}` : null))
          .filter((h): h is string => h !== null),
      );
    expect(hits).toEqual([]);
  });

  it("the body paints the token background, dark by default", () => {
    const css = readFileSync(join(src, "app", "globals.css"), "utf8");
    expect(css).toMatch(/body\s*\{[^}]*background:\s*var\(--bg\)/);
    expect(css).toMatch(/:root\s*\{[^}]*--bg:\s*#050505/);
  });
});
