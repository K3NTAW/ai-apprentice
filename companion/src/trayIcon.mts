// Tray template image drawn in code: a ring with a dot, black on transparent (macOS tints templates).
// Returns raw BGRA pixels for nativeImage.createFromBitmap.
export function trayIconBitmap(size: number): Buffer {
  const buf = Buffer.alloc(size * size * 4);
  const c = (size - 1) / 2;
  const outer = size * 0.45;
  const inner = size * 0.32;
  const dot = size * 0.16;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.hypot(x - c, y - c);
      const on = (d <= outer && d >= inner) || d <= dot;
      if (on) buf[(y * size + x) * 4 + 3] = 255;
    }
  }
  return buf;
}
