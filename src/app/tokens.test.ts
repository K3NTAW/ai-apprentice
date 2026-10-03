// Tokens and fonts against the design canvas copy in docs/design/canvas/ (the contract), not against hard-coded numbers.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("../..", import.meta.url));
const read = (p: string) => readFileSync(join(root, p), "utf8");
const css = read("src/app/globals.css");
const canvas = (f: string) => read(`docs/design/canvas/${f}`);

const norm = (v: string) => v.trim().replace(/\s+/g, "").toLowerCase();

/** --name: value pairs of the first rule whose selector matches, in a CSS string. */
function vars(source: string, selector: RegExp): Record<string, string> {
  const m = source.match(selector);
  if (!m) throw new Error(`selector not found: ${selector}`);
  const start = source.indexOf("{", m.index!) + 1;
  let depth = 1;
  let i = start;
  while (depth > 0 && i < source.length) {
    if (source[i] === "{") depth++;
    if (source[i] === "}") depth--;
    i++;
  }
  const body = source.slice(start, i - 1);
  const out: Record<string, string> = {};
  for (const d of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);?/gi)) out[d[1]] = norm(d[2]);
  return out;
}

const canvasDark = vars(canvas("Components.dc.html"), /\.aa\{/);
const canvasLight = vars(canvas("Gallery.dc.html"), /\.lt\{/);
const cssDark = vars(css, /^:root \{/m);
const cssLightAttr = vars(css, /^:root\[data-theme="light"\] \{/m);
const cssLightMedia = vars(css, /:root:not\(\[data-theme="dark"\]\) \{/);

describe("globals.css tokens equal the canvas", () => {
  it("reads the canvas sources", () => {
    expect(Object.keys(canvasDark).length).toBeGreaterThan(25);
    expect(Object.keys(canvasLight).length).toBeGreaterThan(20);
    expect(canvasDark["--bg"]).toBe("#050505");
    expect(canvasDark["--tx"]).toBe("#ffffff");
    expect(canvasDark["--ac"]).toBe("#4280ff");
  });

  it("dark: every Components.dc.html .aa token", () => {
    for (const [k, v] of Object.entries(canvasDark)) expect([k, cssDark[k]]).toEqual([k, v]);
  });

  it("light: every Gallery.dc.html .lt token, in both the data-theme and the prefers-color-scheme rule", () => {
    for (const [k, v] of Object.entries(canvasLight)) {
      expect([k, cssLightAttr[k]]).toEqual([k, v]);
      expect([k, cssLightMedia[k]]).toEqual([k, v]);
    }
    expect(cssLightAttr["--bg"]).toBe("#ffffff");
    expect(cssLightAttr["--tx"]).toBe("#0a0a0a");
  });

  it("keeps the legacy names as aliases and the Tailwind mappings", () => {
    const alias = { "--fg": "var(--tx)", "--muted": "var(--mu)", "--panel": "var(--s1)", "--panel-2": "var(--s2)", "--line": "var(--ln2)", "--accent": "var(--ac)" };
    for (const [k, v] of Object.entries(alias)) expect(cssDark[k]).toBe(v);
    expect(cssDark["--accent-fg"]).toBeDefined();
    for (const k of ["bg", "panel", "panel-2", "line", "fg", "muted", "accent", "accent-fg"]) expect(css).toContain(`--color-${k}: var(--${k});`);
  });

  it("radii and motion follow the canvas (card 16, section 20, input 12, halo 1.8 s)", () => {
    const comp = canvas("Components.dc.html");
    expect(comp).toContain(".card{background:var(--s1);border:1px solid var(--ln);border-radius:16px}");
    expect(cssDark["--r-card"]).toBe("16px");
    expect(cssDark["--r-section"]).toBe("20px");
    expect(cssDark["--r-input"]).toBe("12px");
    expect(comp).toContain("animation:aa-halo 1.8s ease-in-out infinite");
    expect(cssDark["--motion-halo"]).toBe("1.8sease-in-outinfinite");
  });
});

describe("fonts", () => {
  it("Geist and Geist Mono are the configured families, Instrument Serif for quotes", () => {
    expect(cssDark["--font-sans"]).toContain("var(--font-geist-sans),geist,");
    expect(cssDark["--font-mono"]).toContain('var(--font-geist-mono),"geistmono",');
    expect(cssDark["--font-serif"]).toContain('"instrumentserif"');
    expect(css).toMatch(/body \{[^}]*font-family: var\(--font-sans\)/);
    expect(css).toMatch(/\.ui-qs \{[^}]*font-family: var\(--font-serif\); font-style: italic/);
  });

  it("layout.tsx sets the self-hosted font variables on <html>, nothing fetched from Google", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).toContain('from "geist/font/sans"');
    expect(layout).toContain('from "geist/font/mono"');
    expect(layout).toContain("GeistSans.variable");
    expect(layout).toContain("GeistMono.variable");
    expect(layout).toContain('variable: "--font-instrument-serif"');
    expect(layout).toContain("className={FONT_CLASS}");
    expect(layout).not.toContain("next/font/google");
  });
});

describe("every var(--x) under src/ is defined", () => {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(tsx?|css)$/.test(f) && !/\.test\.tsx?$/.test(f)) files.push(p);
    }
  };
  walk(join(root, "src"));

  it("finds them in globals.css (or as a next/font variable)", () => {
    const defined = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
    for (const v of ["--font-geist-sans", "--font-geist-mono", "--font-instrument-serif"]) defined.add(v);
    const missing: string[] = [];
    for (const f of files) {
      for (const m of readFileSync(f, "utf8").matchAll(/var\((--[a-zA-Z0-9-]+)/g)) {
        if (!defined.has(m[1])) missing.push(`${f.slice(root.length)}: ${m[1]}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("design reference completeness", () => {
  const dir = join(root, "docs/design/canvas");
  const files = readdirSync(dir).sort();
  const readme = read("docs/design/README.md");

  it("README maps every canvas file to a route or component and marks Pairing obsolete", () => {
    expect(files.length).toBeGreaterThan(30);
    for (const f of files) {
      const row = readme.split("\n").find((l) => l.startsWith(`| \`${f}\` |`));
      expect(row, f).toBeDefined();
      const cells = row!.split("|").map((c) => c.trim());
      expect(cells[3]?.length, f).toBeGreaterThan(3);
    }
    expect(readme).toMatch(/\| `Pairing\.dc\.html` \|[^\n]*\*\*obsolete\*\*/);
  });

  it("copies are byte-identical to the source (sha256 manifest from the source folder)", () => {
    const manifest = read("docs/design/canvas.sha256").trim().split("\n").map((l) => l.split(/\s+/));
    expect(manifest.map((m) => m[1]).sort()).toEqual(files);
    for (const [sum, f] of manifest) {
      expect([f, createHash("sha256").update(readFileSync(join(dir, f))).digest("hex")]).toEqual([f, sum]);
    }
  });
});
