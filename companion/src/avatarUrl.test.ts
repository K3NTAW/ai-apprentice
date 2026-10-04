import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import { describe, expect, it } from "vitest";
import { AVATAR_URL_RE, isAvatarUrl, MAX_AVATAR_URL_BYTES, validateAvatarSet } from "./avatarUrl.mjs";

const staticDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "static");
const svg = (s: string) => `data:image/svg+xml;base64,${Buffer.from(s).toString("base64")}`;
const ok = svg('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><circle r="4" cx="5" cy="5"/></svg>');
const PREFIX = "data:image/svg+xml;base64,";
/** The largest well-formed data URL under the cap, and one 4 characters over it. */
const maxUrl = PREFIX + "A".repeat(4 * Math.floor((MAX_AVATAR_URL_BYTES - PREFIX.length) / 4));
const overUrl = maxUrl + "AAAA";

type FakeImg = { src?: string; getAttribute(n: string): string | null; removeAttribute(n: string): void };
const fakeImg = (): FakeImg => ({
  getAttribute(n) {
    return n === "src" ? (this.src ?? null) : null;
  },
  removeAttribute(n) {
    if (n === "src") delete this.src;
  },
});

function loadRendererHelper(): { isAvatarUrl(v: unknown): boolean; setAvatarSrc(img: FakeImg, url: unknown): boolean } {
  const sandbox: Record<string, unknown> = {};
  vm.runInNewContext(fs.readFileSync(path.join(staticDir, "avatarSrc.js"), "utf8"), sandbox);
  return sandbox.companionAvatar as never;
}

const BAD = [
  "data:image/png;base64,iVBORw0KGgo=",
  "data:image/svg+xml,<svg onload=alert(1)>",
  "data:image/svg+xml;utf8,<svg/>",
  "data:text/html;base64,PHNjcmlwdD4=",
  "javascript:alert(1)",
  "https://example.com/a.svg",
  " " + ok,
  ok + "\n",
  "data:image/svg+xml;base64,abc",
  "data:image/svg+xml;base64,",
  overUrl,
  42,
  null,
  undefined,
];

describe("avatar data URLs", () => {
  it("accepts only data:image/svg+xml;base64 URLs up to 100 KB", () => {
    expect(isAvatarUrl(ok)).toBe(true);
    expect(isAvatarUrl(maxUrl)).toBe(true);
    for (const b of BAD) expect(isAvatarUrl(b)).toBe(false);
  });

  it("validates an avatar set: idle required, any bad frame or the total cap rejects it", () => {
    expect(validateAvatarSet({ idle: ok, talking: ok, extra: "x" })).toEqual({ ok: true, avatar: { idle: ok, talking: ok } });
    expect(validateAvatarSet({ talking: ok }).ok).toBe(false);
    expect(validateAvatarSet({ idle: ok, stop: "data:image/png;base64,AAAA" }).ok).toBe(false);
    expect(validateAvatarSet("nope").ok).toBe(false);
    const big = maxUrl;
    const eight = { idle: big, listening: big, thinking: big, talking: big, asking: big, stop: big, happy: big, paused: big };
    expect(validateAvatarSet(eight).ok).toBe(true);
    expect(validateAvatarSet({ ...eight, idle: overUrl }).ok).toBe(false);
  });

  it("the renderer helper uses the same rule and only ever sets an img src", () => {
    const helper = loadRendererHelper();
    expect(helper.isAvatarUrl(ok)).toBe(true);
    for (const b of BAD) expect(helper.isAvatarUrl(b)).toBe(isAvatarUrl(b));
    const img = fakeImg();
    expect(helper.setAvatarSrc(img, ok)).toBe(true);
    expect(img.src).toBe(ok);
    expect(helper.setAvatarSrc(img, "javascript:alert(1)")).toBe(false);
    expect(img.src).toBeUndefined();
    expect(fs.readFileSync(path.join(staticDir, "avatarSrc.js"), "utf8")).toContain(AVATAR_URL_RE.source);
  });

  it("renderers never parse HTML and assign src only through setAvatarSrc", () => {
    const scripts = fs.readdirSync(staticDir).filter((f) => f.endsWith(".js"));
    expect(scripts).toEqual(expect.arrayContaining(["avatarSrc.js", "dock.js", "overlay.js"]));
    for (const f of scripts) {
      const code = fs.readFileSync(path.join(staticDir, f), "utf8");
      expect(code, f).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write|srcdoc/);
      if (f !== "avatarSrc.js") expect(code, f).not.toMatch(/\.src\s*=|setAttribute\(\s*["']src/);
    }
    for (const f of ["dock.js", "overlay.js"]) expect(fs.readFileSync(path.join(staticDir, f), "utf8")).toContain("companionAvatar.setAvatarSrc(");
  });

  it("dock and overlay pages allow images from data: only", () => {
    for (const f of ["dock.html", "overlay.html"]) {
      const html = fs.readFileSync(path.join(staticDir, f), "utf8");
      const csp = /Content-Security-Policy" content="([^"]+)"/.exec(html)?.[1] ?? "";
      expect(csp, f).toContain("default-src 'none'");
      expect(csp, f).toMatch(/img-src data:(;|$)/);
      // T-0136: bundled Geist, fonts from the app only (no remote font hosts).
      expect(csp, f).toContain("font-src 'self'");
      expect(html.indexOf("avatarSrc.js"), f).toBeGreaterThan(0);
    }
  });
});
