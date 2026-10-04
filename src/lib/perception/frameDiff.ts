// Pure frame comparison on RGBA pixel buffers (canvas ImageData.data).

export type DiffOptions = { step?: number; threshold?: number };

/** Share of sampled pixels whose summed RGB delta exceeds threshold. */
export function diffRatio(
  a: Uint8ClampedArray,
  b: Uint8ClampedArray,
  opts: DiffOptions = {},
): number {
  if (a.length !== b.length) return 1;
  const step = Math.max(1, Math.floor(opts.step ?? 4));
  const threshold = opts.threshold ?? 24;
  const pixels = Math.floor(a.length / 4);
  if (pixels === 0) return 0;
  let sampled = 0;
  let changed = 0;
  for (let p = 0; p < pixels; p += step) {
    const i = p * 4;
    const delta =
      Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    sampled++;
    if (delta > threshold) changed++;
  }
  return changed / sampled;
}

export function hasChanged(a: Uint8ClampedArray, b: Uint8ClampedArray, minRatio = 0.002): boolean {
  if (a.length !== b.length) return true;
  const ratio = diffRatio(a, b);
  return ratio > 0 && ratio >= minRatio;
}
