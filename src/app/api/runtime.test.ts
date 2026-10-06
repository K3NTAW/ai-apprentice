import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const API_DIR = path.join(process.cwd(), "src/app/api");
const LONG_RUNNING = ["vision", "workmap", "decide", "workmap/confirm"];
// Routes that answer without a session. Exactly one; growing it needs a spec, not a quiet edit.
const PUBLIC_ROUTES = ["health/route.ts"];

async function routeFiles(dir: string): Promise<string[]> {
  const out: string[] = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await routeFiles(full)));
    else if (entry.name === "route.ts") out.push(full);
  }
  return out;
}

describe("API route segment config", () => {
  it("every route.ts exports runtime 'nodejs'", async () => {
    const files = await routeFiles(API_DIR);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const src = await readFile(file, "utf8");
      expect(src, path.relative(API_DIR, file)).toMatch(/^export const runtime = "nodejs";$/m);
    }
  });

  it("the public allowlist holds only the health route, and it exists", async () => {
    expect(PUBLIC_ROUTES).toEqual(["health/route.ts"]);
    const files = (await routeFiles(API_DIR)).map((f) => path.relative(API_DIR, f));
    expect(files).toContain("health/route.ts");
  });

  it.each(LONG_RUNNING)("%s exports maxDuration within 60 s", async (route) => {
    const src = await readFile(path.join(API_DIR, route, "route.ts"), "utf8");
    const m = src.match(/^export const maxDuration = (\d+);$/m);
    expect(m).not.toBeNull();
    const seconds = Number(m![1]);
    expect(seconds).toBeGreaterThan(0);
    expect(seconds).toBeLessThanOrEqual(60);
  });
});
