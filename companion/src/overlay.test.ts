import { describe, expect, it } from "vitest";
import { clampText, HALO_TTL_MS, HaloStore, mapRect, MAX_HALOS, MAX_TEXT, validateHalo, validateRect } from "./overlay.mjs";

describe("halo rect validation", () => {
  it("accepts rects inside 0..1", () => {
    expect(validateRect({ x: 0, y: 0, w: 1, h: 1 }).ok).toBe(true);
    expect(validateRect({ x: 0.25, y: 0.5, w: 0.5, h: 0.5 }).ok).toBe(true);
    expect(validateRect({ x: 0.7, y: 0.1, w: 0.3, h: 0.2 }).ok).toBe(true);
  });

  it("rejects values outside 0..1, empty and overflowing rects", () => {
    for (const r of [
      { x: -0.1, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 1.1, w: 0.5, h: 0.5 },
      { x: 0, y: 0, w: 1.5, h: 0.5 },
      { x: 0, y: 0, w: 0.5, h: -1 },
      { x: 0, y: 0, w: 0, h: 0.5 },
      { x: 0, y: 0, w: 0.5, h: 0 },
      { x: 0.6, y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0.8, w: 0.5, h: 0.3 },
      { x: Number.NaN, y: 0, w: 0.5, h: 0.5 },
      { x: "0", y: 0, w: 0.5, h: 0.5 },
      { x: 0, y: 0, w: 0.5 },
      null,
      undefined,
    ]) {
      expect(validateRect(r).ok, JSON.stringify(r)).toBe(false);
    }
  });

  it("clamps bubble text to 140 chars", () => {
    const long = "x".repeat(500);
    const r = validateHalo({ id: "a", rect: { x: 0, y: 0, w: 0.1, h: 0.1 }, text: long });
    expect(r.ok && r.halo.text).toHaveLength(MAX_TEXT);
    expect(MAX_TEXT).toBe(140);
    expect(clampText("😀".repeat(200))).toBe("😀".repeat(140));
    expect(clampText("a\nb")).toBe("a b");
  });

  it("rejects bad ids and non-string text", () => {
    const rect = { x: 0, y: 0, w: 0.1, h: 0.1 };
    expect(validateHalo({ id: "", rect }).ok).toBe(false);
    expect(validateHalo({ id: 3, rect }).ok).toBe(false);
    expect(validateHalo({ id: "a".repeat(200), rect }).ok).toBe(false);
    expect(validateHalo({ id: "a", rect, text: 5 }).ok).toBe(false);
    expect(validateHalo({ id: "a", rect })).toEqual({ ok: true, halo: { id: "a", rect } });
  });
});

describe("rect mapping", () => {
  it("maps normalised rects to display DIP", () => {
    const d = { bounds: { x: 0, y: 0, width: 1440, height: 900 }, scaleFactor: 2 };
    expect(mapRect({ x: 0.5, y: 0.5, w: 0.25, h: 0.5 }, d)).toEqual({ x: 720, y: 450, w: 360, h: 450 });
  });

  it("snaps to device pixels for the scale factor", () => {
    const d = { bounds: { x: 0, y: 0, width: 1000, height: 1000 }, scaleFactor: 2 };
    const r = mapRect({ x: 0.0003, y: 0.0007, w: 0.1, h: 0.1 }, d);
    for (const v of Object.values(r)) expect((v * 2) % 1).toBe(0);
    const d1 = { bounds: { x: 0, y: 0, width: 1000, height: 1000 }, scaleFactor: 1 };
    for (const v of Object.values(mapRect({ x: 0.0003, y: 0.0007, w: 0.1, h: 0.1 }, d1))) expect(Number.isInteger(v)).toBe(true);
    expect(mapRect({ x: 0, y: 0, w: 1, h: 1 }, { ...d, scaleFactor: 0 })).toEqual({ x: 0, y: 0, w: 1000, h: 1000 });
  });
});

describe("halo store", () => {
  const rect = { x: 0, y: 0, w: 0.1, h: 0.1 };

  it("clears by id or all", () => {
    const s = new HaloStore();
    s.upsert({ id: "a", rect }, 0);
    s.upsert({ id: "b", rect }, 0);
    expect(s.clear("a")).toBe(true);
    expect(s.list().map((h) => h.id)).toEqual(["b"]);
    expect(s.clear()).toBe(true);
    expect(s.list()).toEqual([]);
    expect(s.clear()).toBe(false);
  });

  it("caps the halo count and expires by TTL", () => {
    const s = new HaloStore();
    for (let i = 0; i < MAX_HALOS + 3; i++) s.upsert({ id: `h${i}`, rect }, i);
    expect(s.list()).toHaveLength(MAX_HALOS);
    expect(s.list()[0].id).toBe("h3");
    expect(s.expire(HALO_TTL_MS + 3)).toBe(true);
    expect(s.list()[0].id).toBe("h4");
    s.upsert({ id: "h4", rect }, HALO_TTL_MS * 2);
    expect(s.expire(HALO_TTL_MS * 2 + 1)).toBe(true);
    expect(s.list().map((h) => h.id)).toEqual(["h4"]);
  });
});
