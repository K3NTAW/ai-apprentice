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
      for (const a of attrs) {
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
    expect(renderAvatarSvg(DEFAULT_AVATAR, "stop", 64)).toContain("#EF4444");
    expect(renderAvatarSvg(DEFAULT_AVATAR, "paused", 64)).toContain(">z<");
  });

  it("neutralises hostile input", () => {
    const evil = { shape: "<script>", face: "x", color: '"/><script>alert(1)</script>', accent: "url(http://x)" } as unknown as Avatar;
    const svg = renderAvatarSvg(evil, "nope" as never, 1e9);
    expect(svg).not.toMatch(/script|http:/);
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
