// Dark canvas everywhere (design-visual-capture F1): no page, layout or component paints a light content background.
// Light mode comes only from the tokens (data-theme="light" or the OS preference), never from hard-coded classes,
// arbitrary values (bg-[#fff]), inline styles or CSS rules outside the light theme blocks. Scans .ts, .tsx and .css.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";

const LIGHT_CLASS = /\b(?:[a-z]+:)?bg-(?:white|slate-(?:50|100|200|300)|gray-\d+|neutral-(?:50|100|200)|zinc-(?:50|100|200))\b|#F0F3F6/i;
/** bg-[<value>] arbitrary Tailwind backgrounds. */
const ARBITRARY_BG = /\bbg-\[([^\]]+)\]/gi;
/** Inline styles and CSS rules: background / background-color / backgroundColor with a literal value. */
const BG_DECL = /\bbackground(?:-color|Color)?\s*:\s*["'`]?([^;"'`}]+)/gi;

/** Relative luminance (0..1) of a literal colour; null for tokens, gradients and anything not a plain colour. */
function luminance(value: string): number | null {
  const v = value.trim().toLowerCase();
  if (v === "white" || v === "#fff" || v === "#ffffff") return 1;
  let rgb: number[] | null = null;
  const hex = v.match(/^#([0-9a-f]{3,8})\b/);
  if (hex) {
    const h = hex[1];
    const full = h.length <= 4 ? h.slice(0, 3).split("").map((c) => c + c).join("") : h.slice(0, 6);
    if (full.length === 6) rgb = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  }
  const fn = v.match(/^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/);
  if (fn) rgb = [fn[1], fn[2], fn[3]].map(Number);
  if (!rgb) return null;
  const [r, g, b] = rgb.map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

const isLight = (value: string) => (luminance(value) ?? 0) > 0.5;

/** Blanks the light theme blocks (OS preference and data-theme="light"), keeping line numbers. */
function withoutLightThemeBlocks(css: string): string {
  let out = css;
  for (const sel of [/@media\s*\(prefers-color-scheme:\s*light\)/g, /:root\[data-theme="light"\]/g]) {
    let m: RegExpExecArray | null;
    while ((m = sel.exec(out))) {
      const open = out.indexOf("{", m.index);
      if (open < 0) break;
      let depth = 0;
      let end = open;
      for (; end < out.length; end++) {
        if (out[end] === "{") depth++;
        else if (out[end] === "}" && --depth === 0) break;
      }
      out = out.slice(0, m.index) + out.slice(m.index, end + 1).replace(/[^\n]/g, " ") + out.slice(end + 1);
    }
  }
  return out;
}

/** 1-based line numbers that paint a light background. */
function lightBackgroundLines(text: string, file: string): number[] {
  const src = file.endsWith(".css") ? withoutLightThemeBlocks(text) : text;
  const hits: number[] = [];
  src.split("\n").forEach((line, i) => {
    const arbitrary = [...line.matchAll(ARBITRARY_BG)].some((m) => isLight(m[1]));
    const decl = [...line.matchAll(BG_DECL)].some((m) => isLight(m[1]));
    if ((!file.endsWith(".css") && LIGHT_CLASS.test(line)) || arbitrary || decl) hits.push(i + 1);
  });
  return hits;
}

function files(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) files(p, out);
    else if (/\.(ts|tsx|css)$/.test(name) && !/\.test\./.test(name) && !name.endsWith(".d.ts")) out.push(p);
  }
  return out;
}

describe("no light content background in dark mode", () => {
  const src = join(process.cwd(), "src");
  const all = [...files(join(src, "app")), ...files(join(src, "components"))];

  it("the check catches light classes, arbitrary values, inline styles and CSS outside the light theme", () => {
    expect(lightBackgroundLines('<div className="p-4 bg-[#fff]" />', "x.tsx")).toEqual([1]);
    expect(lightBackgroundLines('const c = "rounded bg-[#FAFAFA]";', "x.ts")).toEqual([1]);
    expect(lightBackgroundLines('const c = "bg-white";', "x.ts")).toEqual([1]);
    expect(lightBackgroundLines('<div style={{ background: "#ffffff" }} />', "x.tsx")).toEqual([1]);
    expect(lightBackgroundLines("<div style={{ backgroundColor: 'rgb(250, 250, 250)' }} />", "x.tsx")).toEqual([1]);
    expect(lightBackgroundLines(".card {\n  background: #fff;\n}", "x.css")).toEqual([2]);
    expect(lightBackgroundLines(':root[data-theme="light"] {\n  --bg: #fff;\n  background: #fff;\n}', "x.css")).toEqual([]);
    expect(lightBackgroundLines("@media (prefers-color-scheme: light) {\n  :root { background: white; }\n}", "x.css")).toEqual([]);
    // dark values and tokens pass
    expect(lightBackgroundLines('<div className="bg-[#050505]" style={{ background: "var(--s2)" }} />', "x.tsx")).toEqual([]);
  });

  it("no route, layout, component or stylesheet hard-codes a light background", () => {
    const hits = all.flatMap((f) => lightBackgroundLines(readFileSync(f, "utf8"), f).map((n) => `${relative(src, f)}:${n}`));
    expect(hits).toEqual([]);
  });

  it("the body paints the token background, dark by default", () => {
    const css = readFileSync(join(src, "app", "globals.css"), "utf8");
    expect(css).toMatch(/body\s*\{[^}]*background:\s*var\(--bg\)/);
    expect(css).toMatch(/:root\s*\{[^}]*--bg:\s*#050505/);
  });
});
