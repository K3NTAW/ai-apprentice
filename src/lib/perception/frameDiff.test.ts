import { describe, expect, it } from "vitest";
import { diffRatio, hasChanged } from "./frameDiff";

function frame(pixels: number, rgb: [number, number, number]) {
  const buf = new Uint8ClampedArray(pixels * 4);
  for (let p = 0; p < pixels; p++) buf.set([...rgb, 255], p * 4);
  return buf;
}

describe("frameDiff", () => {
  it("identical frames have ratio 0 and are unchanged", () => {
    const a = frame(1000, [10, 20, 30]);
    expect(diffRatio(a, frame(1000, [10, 20, 30]))).toBe(0);
    expect(hasChanged(a, frame(1000, [10, 20, 30]))).toBe(false);
  });

  it("small deltas under the threshold are ignored", () => {
    expect(diffRatio(frame(100, [10, 10, 10]), frame(100, [15, 15, 15]))).toBe(0);
  });

  it("counts the share of sampled pixels over threshold", () => {
    const a = frame(800, [0, 0, 0]);
    const b = frame(800, [0, 0, 0]);
    for (let p = 0; p < 400; p++) b.set([200, 200, 200], p * 4);
    expect(diffRatio(a, b, { step: 1 })).toBeCloseTo(0.5);
    expect(diffRatio(a, b)).toBeCloseTo(0.5);
    expect(hasChanged(a, b)).toBe(true);
  });

  it("respects minRatio", () => {
    const a = frame(4000, [0, 0, 0]);
    const b = frame(4000, [0, 0, 0]);
    b.set([255, 255, 255], 0);
    expect(hasChanged(a, b)).toBe(true); // 1 of 1000 sampled = 0.001 < 0.002
    expect(hasChanged(a, b, 0.5)).toBe(false);
  });

  it("different lengths count as changed", () => {
    expect(hasChanged(frame(10, [0, 0, 0]), frame(11, [0, 0, 0]))).toBe(true);
    expect(diffRatio(frame(10, [0, 0, 0]), frame(11, [0, 0, 0]))).toBe(1);
  });
});
