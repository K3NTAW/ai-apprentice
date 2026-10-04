// Prints the canvas token values next to the shipped ones (docs/checks/design-companion.md visual aid).
// Usage: node scripts/canvas-values.mjs [path to Dock.dc.html]  (default: ../docs/design/canvas/Dock.dc.html)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const canvasFile = process.argv[2] ?? path.join(here, "..", "..", "docs", "design", "canvas", "Dock.dc.html");
const shipped = fs.readFileSync(path.join(here, "..", "static", "canvas.css"), "utf8");
const vars = (css) => Object.fromEntries([...css.matchAll(/(--[a-z0-9]+)\s*:\s*([^;}]+)/gi)].map((m) => [m[1], m[2].trim()]));

if (!fs.existsSync(canvasFile)) {
  console.error(`canvas file not found: ${canvasFile}`);
  process.exit(1);
}
const canvas = vars(/\.gl\{([^}]*)\}/.exec(fs.readFileSync(canvasFile, "utf8"))?.[1] ?? "");
const ours = vars(shipped);
let diff = 0;
console.log(["token", "canvas", "shipped", ""].join("\t"));
for (const [k, v] of Object.entries(canvas)) {
  const same = (ours[k] ?? "").replace(/\s+/g, "") === v.replace(/\s+/g, "");
  if (!same) diff++;
  console.log([k, v, ours[k] ?? "(missing)", same ? "ok" : "DIFF"].join("\t"));
}
process.exit(diff ? 1 : 0);
