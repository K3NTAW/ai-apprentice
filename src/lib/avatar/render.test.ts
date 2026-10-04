import { describe, expect, it } from "vitest";
import {
  AVATAR_FACES,
  AVATAR_SHAPES,
  AVATAR_STATES,
  type Avatar,
  DEFAULT_AVATAR,
  MAX_DATA_URL_BYTES,
  normalizeAvatar,
  randomAvatar,
  renderAvatarSet,
  renderAvatarSvg,
  toDataUrl,
} from "./render";

// jsdom is not a dependency, so a strict well-formedness check stands in for DOMParser:
// every tag balanced, every attribute double-quoted, no stray '<' or '&'.
function parseXml(xml: string): { tags: string[]; attrs: { name: string; value: string }[] } {
  const stack: string[] = [];
  const tags: string[] = [];
  const attrs: { name: string; value: string }[] = [];
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[\w:-]+="[^"<]*")*)\s*(\/?)>/y;
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    const text = xml.slice(i, lt === -1 ? xml.length : lt);
    if (/&(?!(amp|lt|gt|quot|apos);)/.test(text)) throw new Error(`bad entity in text: ${text}`);
    if (lt === -1) break;
    tagRe.lastIndex = lt;
    const m = tagRe.exec(xml);
    if (!m) throw new Error(`malformed tag at ${lt}: ${xml.slice(lt, lt + 60)}`);
    const [, close, name, attrText, selfClose] = m;
    if (close) {
      if (stack.pop() !== name) throw new Error(`unbalanced </${name}>`);
    } else {
      tags.push(name);
      for (const a of attrText.matchAll(/([\w:-]+)="([^"]*)"/g)) attrs.push({ name: a[1], value: a[2] });
      if (!selfClose) stack.push(name);
    }
    i = tagRe.lastIndex;
  }
  if (stack.length) throw new Error(`unclosed <${stack.join(",")}>`);
  if (tags[0] !== "svg") throw new Error("root is not <svg>");
  return { tags, attrs };
}

const all: { avatar: Avatar; state: (typeof AVATAR_STATES)[number] }[] = [];
for (const shape of AVATAR_SHAPES)
  for (const face of AVATAR_FACES)
    for (const state of AVATAR_STATES) all.push({ avatar: { shape, face, color: "#5E60CE", accent: "#FF8FAB" }, state });

describe("renderAvatarSvg", () => {
  it("renders safe, well-formed SVG for every shape x face x state", () => {
    expect(all).toHaveLength(6 * 6 * 8);
    for (const { avatar, state } of all) {
      const svg = renderAvatarSvg(avatar, state, 128);
      const { tags, attrs } = parseXml(svg);
      const lower = tags.map((t) => t.toLowerCase());
      expect(lower).not.toContain("script");
      expect(lower).not.toContain("foreignobject");
      expect(lower).not.toContain("image");
      expect(lower).not.toContain("use");
      for (const a of attrs.filter((x) => !(x.name === "xmlns" && x.value === "http://www.w3.org/2000/svg"))) {
        expect(a.name.toLowerCase().startsWith("on")).toBe(false);
        if (/href$/i.test(a.name)) expect(a.value.startsWith("#")).toBe(true);
        expect(a.value).not.toMatch(/url\((?!#)/);
        expect(a.value).not.toMatch(/javascript:|https?:|data:/i);
      }
      expect(svg).not.toMatch(/<script|foreignObject|\son\w+=|@import/i);
      expect(new TextEncoder().encode(svg).length).toBeLessThan(MAX_DATA_URL_BYTES);
      expect(toDataUrl(svg).length).toBeLessThanOrEqual(MAX_DATA_URL_BYTES);
    }
  });

  it("is deterministic for the same input and differs across states", () => {
    for (const { avatar, state } of all) expect(renderAvatarSvg(avatar, state, 96)).toBe(renderAvatarSvg({ ...avatar }, state, 96));
    const set = new Set(AVATAR_STATES.map((s) => renderAvatarSvg(DEFAULT_AVATAR, s, 96)));
    expect(set.size).toBe(AVATAR_STATES.length);
  });

  it("has an animation in every state and the size on the root", () => {
    for (const state of AVATAR_STATES) {
      const svg = renderAvatarSvg(DEFAULT_AVATAR, state, 200);
      expect(svg).toMatch(/<animate/);
      expect(svg).toContain('width="200" height="200"');
    }
    expect(renderAvatarSvg(DEFAULT_AVATAR, "asking", 64)).toContain(">?<");
    expect(renderAvatarSvg(DEFAULT_AVATAR, "stop", 64)).toContain("#FF8A65");
    expect(renderAvatarSvg(DEFAULT_AVATAR, "stop", 64)).toContain(">!<");
    expect(renderAvatarSvg(DEFAULT_AVATAR, "paused", 64)).toContain('fill="#2A2A2E"');
  });

  it("draws the canvas clay: dark outline, tilted oval eyes, glossy highlight", () => {
    for (const shape of AVATAR_SHAPES) {
      const svg = renderAvatarSvg({ ...DEFAULT_AVATAR, shape }, "idle", 96);
      expect(svg).toContain('stroke="#0A0A0C" stroke-width="3.2"');
      expect(svg).toMatch(/<radialGradient id="av\w+b" cx="0.34" cy="0.3" r="0.75">/);
      expect(svg).toMatch(/fill="#FFFFFF" opacity="0.7"[^>]*rotate\(-28 /);
      expect(svg).toContain('operator="out"');
    }
    const smile = renderAvatarSvg({ ...DEFAULT_AVATAR, face: "smile" }, "talking", 96);
    expect(smile).toContain('<ellipse cx="39.5" cy="43" rx="4.5" ry="7" fill="#0A0A0C" transform="rotate(-12 39.5 43)"/>');
    expect(smile).toContain('<ellipse cx="60.5" cy="41" rx="4.5" ry="7" fill="#0A0A0C" transform="rotate(-12 60.5 41)"/>');
    expect(renderAvatarSvg({ ...DEFAULT_AVATAR, face: "curious" }, "idle", 96)).toContain('transform="rotate(-10 ');
    expect(renderAvatarSvg({ ...DEFAULT_AVATAR, face: "smile" }, "idle", 96)).toContain('keyTimes="0;0.93;0.96;1"');
    expect(renderAvatarSvg({ ...DEFAULT_AVATAR, face: "smile" }, "idle", 96)).toContain('viewBox="0 -2 100 100"');
  });

  it("renders the dark rounded tile variant", () => {
    for (const state of AVATAR_STATES) {
      const svg = renderAvatarSvg(DEFAULT_AVATAR, state, 140, { tile: true });
      parseXml(svg);
      expect(svg).toContain('viewBox="0 0 140 140"');
      expect(svg).toMatch(/<rect width="140" height="140" rx="18" fill="url\(#av\w+\)"\/>/);
      expect(svg).toContain('stop-color="#232327"');
      expect(svg).toContain('stop-color="#0A0A0C"');
      expect(svg).toContain('<g transform="translate(20 20)">');
      expect(svg).not.toBe(renderAvatarSvg(DEFAULT_AVATAR, state, 140));
      expect(toDataUrl(svg).length).toBeLessThanOrEqual(MAX_DATA_URL_BYTES);
    }
    expect(renderAvatarSvg(DEFAULT_AVATAR, "idle", 140)).not.toContain("#232327");
  });

  it("neutralises hostile input", () => {
    const evil = { shape: "<script>", face: "x", color: '"/><script>alert(1)</script>', accent: "url(http://x)" } as unknown as Avatar;
    const svg = renderAvatarSvg(evil, "nope" as never, 1e9);
    expect(svg).not.toMatch(/script|http:\/\/x/);
    expect(svg).toContain('width="1024"');
    expect(normalizeAvatar(evil)).toEqual(DEFAULT_AVATAR);
  });
});

describe("toDataUrl", () => {
  it("encodes base64 SVG and guards 100 KB", () => {
    const svg = renderAvatarSvg(DEFAULT_AVATAR, "idle", 64);
    const url = toDataUrl(svg);
    expect(url.startsWith("data:image/svg+xml;base64,")).toBe(true);
    expect(atob(url.split(",")[1])).toBe(svg);
    expect(() => toDataUrl(`<svg>${"x".repeat(MAX_DATA_URL_BYTES)}</svg>`)).toThrow(/100 KB/);
  });

  it("renders the full eight-state set and randomizes from the palette", () => {
    expect(Object.keys(renderAvatarSet(DEFAULT_AVATAR))).toEqual([...AVATAR_STATES]);
    let seed = 1;
    const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let k = 0; k < 20; k++) {
      const a = randomAvatar(rand);
      expect(normalizeAvatar(a)).toEqual(a);
      expect(a.color).not.toBe(a.accent);
    }
  });
});
