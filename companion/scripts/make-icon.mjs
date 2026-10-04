// Draws the app icon (ring with a dot) as PNGs and builds assets/icon.icns with
// iconutil (macOS). No dependencies: PNG encoded with node:zlib. Run: node scripts/make-icon.mjs
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};

function png(size) {
  const rows = [];
  const s = size / 1024;
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 4);
    for (let x = 0; x < size; x++) {
      const px = (x + 0.5) / s, py = (y + 0.5) / s;
      // rounded square background
      const m = 100, r = 180;
      const dx = Math.max(m + r - px, 0, px - (1024 - m - r)), dy = Math.max(m + r - py, 0, py - (1024 - m - r));
      const inBg = px >= m && px <= 1024 - m && py >= m && py <= 1024 - m && Math.hypot(dx, dy) <= r;
      const d = Math.hypot(px - 512, py - 512);
      let rgba = [0, 0, 0, 0];
      if (inBg) rgba = [24, 24, 30, 255];
      if (inBg && d >= 220 && d <= 290) rgba = [138, 180, 255, 255];
      if (inBg && d <= 90) rgba = [240, 240, 245, 255];
      row.set(rgba, 1 + x * 4);
    }
    rows.push(row);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr.set([8, 6, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", zlib.deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const root = path.dirname(path.dirname(new URL(import.meta.url).pathname));
const set = path.join(root, "assets", "icon.iconset");
fs.mkdirSync(set, { recursive: true });
for (const base of [16, 32, 128, 256, 512]) {
  fs.writeFileSync(path.join(set, `icon_${base}x${base}.png`), png(base));
  fs.writeFileSync(path.join(set, `icon_${base}x${base}@2x.png`), png(base * 2));
}
execFileSync("iconutil", ["-c", "icns", set, "-o", path.join(root, "assets", "icon.icns")]);
fs.rmSync(set, { recursive: true });
console.log("assets/icon.icns written");
