import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CANVAS_CLASSES, CANVAS_TOKENS, FONT_FILES, FONT_LICENSE, SURFACES } from "./design.mjs";
import { dockLabels } from "./dock.mjs";
import { materialOptions, panelMaterial, SOLID_BACKGROUND, surfaceMaterial } from "./panel.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticDir = path.join(root, "static");
const read = (f: string) => fs.readFileSync(path.join(staticDir, f), "utf8");
const squash = (s: string) => s.replace(/\s+/g, "");
const canvasCss = read("canvas.css");

type Path = {
  MAX_POINTS: number;
  flightPoints(a: object, c: object, b: object, n: number, bounds: object): { x: number; y: number }[];
  pathData(p: unknown): string;
  showPath(o: object): boolean;
};
function loadPath(): Path {
  const sandbox: { window: { companionPath?: Path } } = { window: {} };
  vm.runInNewContext(read("flightPath.js"), sandbox);
  return sandbox.window.companionPath as Path;
}

describe("canvas tokens and classes", () => {
  it("canvas.css defines every canvas custom property with the canvas value, light only", () => {
    for (const [name, value] of Object.entries(CANVAS_TOKENS)) expect(squash(canvasCss), name).toContain(`${name}:${value.replace(/\s+/g, "")}`);
    expect(canvasCss).toContain("color-scheme: light;");
    for (const f of ["canvas.css", "dock.css", "panel.css", "overlay.css", "setup.css"]) expect(read(f), f).not.toContain("prefers-color-scheme: dark");
  });

  it("canvas.css defines the shared classes: frosted glass, black and white pill buttons, Geist", () => {
    for (const c of CANVAS_CLASSES) expect(canvasCss, c).toMatch(new RegExp(`\\.${c}\\s*\\{`));
    expect(squash(canvasCss)).toContain("--glass-bg:rgba(251,251,251,.84)");
    expect(squash(canvasCss)).toContain("backdrop-filter:var(--glass-blur)");
    expect(squash(canvasCss)).toContain("--glass-blur:blur(24px)saturate(1.5)");
    expect(squash(canvasCss)).toMatch(/\.btn\{[^}]*border-radius:999px/);
    expect(squash(canvasCss)).toMatch(/\.bk\{background:#111111;color:#FFFFFF/);
    expect(squash(canvasCss)).toContain("--font:Geist,");
    expect(squash(canvasCss)).toContain('--mono:"GeistMono",');
  });

  it("every surface page links canvas.css, its own sheet, and uses the canvas classes and tokens", () => {
    for (const s of SURFACES) {
      const html = read(s.html);
      const css = read(s.css);
      expect(html.indexOf('href="canvas.css"'), s.html).toBeGreaterThan(0);
      expect(html.indexOf('href="canvas.css"'), s.html).toBeLessThan(html.indexOf(`href="${s.css}"`));
      expect(html, s.html).toContain('<body class="gl">');
      for (const c of s.classes) expect(`${html}\n${css}\n${read(s.js)}`, `${s.html} .${c}`).toMatch(new RegExp(`(class="[^"]*\\b${c}\\b|\\.${c}\\b|"[^"]*\\b${c}\\b[^"]*")`));
      expect(css, s.css).toMatch(/var\(--(tx|mu|bl|rd|gr|halo|fa|ln)\)/);
    }
  });

  it("lowercase comes from the copy, never from text-transform (user content stays as typed)", () => {
    for (const f of ["canvas.css", "dock.css", "panel.css", "overlay.css", "setup.css"]) expect(read(f), f).not.toMatch(/text-transform/);
    expect(read("dock.html")).toContain("what i learned");
    expect(read("panel.html")).toContain(">shortcuts<");
  });

  it("dock, collapsed tab and off the record follow Dock.dc.html", () => {
    const css = squash(read("dock.css"));
    expect(css).toMatch(/\.full\{[^}]*border-radius:24px/);
    expect(css).toMatch(/\.tab\{[^}]*border-radius:20px0020px/);
    expect(css).toMatch(/\.avatar-tile\{width:76px;height:76px;border-radius:22px/);
    expect(css).toContain(".dock.off.full{filter:saturate(.15);}");
    expect(css).toContain(".dock.off.feed{opacity:.45;}");
    expect(read("dock.html")).toContain("Off the record · nothing is captured");
    expect(read("dock.js")).toContain("Back on the record");
  });

  it("cursor buddy caption, stop halo and dotted path follow Buddy.dc.html", () => {
    const css = squash(read("overlay.css"));
    expect(css).toMatch(/\.halo\{[^}]*border-radius:8px/);
    expect(css).toContain("0002.5pxvar(--halo)");
    expect(css).toContain("animation:aa-halo1.8sease-in-outinfinite");
    expect(css).toMatch(/\.caption\{[^}]*border-radius:6px22px22px22px/);
    expect(css).toMatch(/\.caption\.say\{[^}]*border-radius:6px20px20px20px/);
    expect(css).toMatch(/\.flightpath\{[^}]*stroke:var\(--bl\);stroke-width:2\.5;stroke-linecap:round;stroke-dasharray:29/);
    expect(squash(canvasCss)).toContain("@keyframesaa-dash{to{stroke-dashoffset:-40;}}");
    expect(css).toContain("@media(prefers-reduced-motion:reduce)");
  });

  it("panel follows FloatPanel.dc.html", () => {
    const css = squash(read("panel.css"));
    expect(css).toMatch(/\.sheet\{[^}]*padding:22px/);
    expect(css).toMatch(/\.card\{border-radius:18px;padding:14px16px/);
    expect(read("panel.html")).toContain('class="btn bk">Open control room');
  });

  it("dock labels are lowercase canvas copy", () => {
    expect(dockLabels({ mode: "capture", buddy: "listening", offRecord: false, paused: false })).toEqual({ header: "ai apprentice · training", stateLabel: "listening · quiet while you type", recLabel: "rec" });
    expect(dockLabels({ mode: "teach", buddy: "idle", offRecord: true, paused: false }).stateLabel).toBe("paused · off the record");
    expect(dockLabels({ mode: null, buddy: "idle", offRecord: false, paused: true })).toEqual({ header: "ai apprentice", stateLabel: "paused", recLabel: "paused" });
  });
});

describe("bundled fonts and CSP", () => {
  it("every referenced font file exists in static/, is covered by build.files and ships with the OFL", () => {
    const refs = [...canvasCss.matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]);
    expect(refs.sort()).toEqual([...FONT_FILES].sort());
    for (const f of [...refs, FONT_LICENSE]) expect(fs.existsSync(path.join(staticDir, f)), f).toBe(true);
    expect(read(FONT_LICENSE)).toContain("SIL Open Font License");
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
    expect(pkg.build.files).toContain("static/**");
  });

  it("each page that uses Geist allows font-src 'self' only and links no remote fonts", () => {
    for (const s of SURFACES) {
      const html = read(s.html);
      const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
      expect(csp, s.html).toContain("default-src 'none'");
      expect(csp, s.html).toMatch(/font-src 'self'(;|$)/);
      expect(csp, s.html).not.toContain("unsafe-inline");
    }
    for (const f of fs.readdirSync(staticDir).filter((n) => /\.(html|css)$/.test(n))) expect(read(f), f).not.toMatch(/fonts\.googleapis|fonts\.gstatic|https?:\/\/[^"' ]*\.woff/);
  });
});

describe("window material", () => {
  it("picks vibrancy, mica, acrylic or solid per surface from the platform and Windows build", () => {
    expect(surfaceMaterial("panel", "darwin", "15.0")).toBe("vibrancy");
    expect(surfaceMaterial("panel", "win32", "10.0.22621")).toBe("mica");
    expect(surfaceMaterial("panel", "win32", "10.0.22000")).toBe("solid");
    expect(surfaceMaterial("dock", "win32", "10.0.26100")).toBe("acrylic");
    expect(surfaceMaterial("dock", "win32", "10.0.19045")).toBe("solid");
    expect(surfaceMaterial("dock", "darwin", "15.0")).toBe("solid");
    expect(surfaceMaterial("overlay", "win32", "10.0.26100")).toBe("solid");
    expect(surfaceMaterial("overlay", "darwin", "15.0")).toBe("solid");
    expect(surfaceMaterial("panel", "win32", "garbage")).toBe("solid");
    expect(panelMaterial("linux", "6.1")).toBe("solid");
  });

  it("the solid fallback paints the canvas colour; native materials keep the window clear", () => {
    expect(SOLID_BACKGROUND).toBe("#FBFBFB");
    expect(materialOptions("solid")).toEqual({ backgroundColor: "#FBFBFB" });
    expect(materialOptions("mica")).toEqual({ backgroundMaterial: "mica", backgroundColor: "#00000000" });
    expect(materialOptions("acrylic").backgroundMaterial).toBe("acrylic");
    expect(materialOptions("vibrancy").vibrancy).toBe("under-window");
  });

  it("main falls back to solid when a window with a material cannot be created", () => {
    const src = fs.readFileSync(path.join(root, "src", "main.mts"), "utf8");
    expect(src).toContain('return createDock("solid");');
    expect(src).toContain('material = "solid";');
  });
});

describe("dotted flight path", () => {
  const geo = loadPath();
  const bounds = { width: 1440, height: 900 };

  it("is a pure curve from start to end, capped at MAX_POINTS", () => {
    const pts = geo.flightPoints({ x: 600, y: 548 }, { x: 850, y: 300 }, { x: 1104, y: 286 }, 1000, bounds);
    expect(pts).toHaveLength(geo.MAX_POINTS);
    expect(pts[0]).toEqual({ x: 600, y: 548 });
    expect(pts.at(-1)).toEqual({ x: 1104, y: 286 });
    expect(geo.flightPoints({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 }, 0, bounds)).toHaveLength(2);
    expect(geo.pathData(pts).startsWith("M600 548 L")).toBe(true);
    expect(geo.pathData([])).toBe("");
  });

  it("stays on this display: points are clamped to the overlay window (multi-display)", () => {
    const pts = geo.flightPoints({ x: -300, y: 100 }, { x: 200, y: -500 }, { x: 2000, y: 1200 }, 12, bounds);
    for (const p of pts) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1440);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(900);
    }
  });

  it("shows only while flying, visible on this display, with motion allowed and capture on", () => {
    const on = { flying: true, visible: true, reducedMotion: false, paused: false, offRecord: false };
    expect(geo.showPath(on)).toBe(true);
    for (const k of ["flying", "visible"]) expect(geo.showPath({ ...on, [k]: false }), k).toBe(false);
    for (const k of ["reducedMotion", "paused", "offRecord"]) expect(geo.showPath({ ...on, [k]: true }), k).toBe(false);
    expect(geo.showPath(null as unknown as object)).toBe(false);
  });

  it("overlay.js clears the path on end, stop, error and off the record, and jumps under reduced motion", () => {
    const js = read("overlay.js");
    expect(js).toContain("prefers-reduced-motion: reduce");
    expect(js).toContain("clearPath();");
    expect(js).toMatch(/catch \{\s*clearPath\(\);/);
    expect(js).not.toMatch(/innerHTML/);
    expect(read("overlay.html").indexOf("flightPath.js")).toBeLessThan(read("overlay.html").indexOf("overlay.js"));
  });
});
