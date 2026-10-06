// Guard (T-0310): API code logs through src/lib/log, and every route handler writes a request line.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const API_DIR = path.join(process.cwd(), "src/app/api");
const METHODS = "GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS";

const files = (readdirSync(API_DIR, { recursive: true }) as string[])
  .filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f))
  .map((f) => ({ rel: f, src: readFileSync(path.join(API_DIR, f), "utf8") }));
const routes = files.filter((f) => path.basename(f.rel) === "route.ts");

/** Exported handlers that are not wrapped: function bodies must start with return withApi/withMutation(, consts must be withRequestLog(. */
function unwrapped(src: string): string[] {
  const bad: string[] = [];
  const fn = new RegExp(String.raw`^export (?:async )?function (${METHODS})\([^]*?\)[^{\n]*\{\s*([^\n]*)`, "gm");
  for (const m of src.matchAll(fn)) if (!/^return (?:withApi|withMutation)\(/.test(m[2])) bad.push(m[1]);
  const named = new RegExp(String.raw`^export (?:const|let|var) (${METHODS})\b\s*=\s*([^\n]*)`, "gm");
  for (const m of src.matchAll(named)) if (!/^withRequestLog\(/.test(m[2])) bad.push(m[1]);
  // Re-exports (export { GET } from ...) bypass both wrappers.
  for (const m of src.matchAll(/^export\s*\{([^}]*)\}/gm))
    for (const name of m[1].split(",").map((s) => s.trim().split(/\s+as\s+/).pop() ?? ""))
      if (new RegExp(`^(?:${METHODS})$`).test(name)) bad.push(name);
  return bad;
}

const handlers = (src: string) => [
  ...src.matchAll(new RegExp(String.raw`^export (?:(?:async )?function|const|let|var) (${METHODS})\b`, "gm")),
];

describe("API logging guard", () => {
  it("finds the API files", () => {
    expect(routes.length).toBeGreaterThan(20);
  });

  it("no console.warn or console.error in non-test files under src/app/api", () => {
    const hits = files.filter((f) => /console\.(?:warn|error)\b/.test(f.src)).map((f) => f.rel);
    expect(hits).toEqual([]);
  });

  it("every route.ts handler is wrapped by withApi or withRequestLog", () => {
    const bad = routes.flatMap((f) => unwrapped(f.src).map((m) => `${f.rel} ${m}`));
    expect(bad).toEqual([]);
    for (const f of routes) expect(handlers(f.src).length, f.rel).toBeGreaterThan(0);
  });

  it("the check catches an unwrapped handler", () => {
    expect(unwrapped("export async function GET(req: Request) {\n  return Response.json({});\n}")).toEqual(["GET"]);
    expect(unwrapped('export const POST = async (req: Request) => Response.json({});')).toEqual(["POST"]);
    expect(unwrapped('export { GET } from "../x/route";')).toEqual(["GET"]);
    expect(unwrapped('export async function GET(req: Request) {\n  return withApi({ route: "/api/x", req }, async () => x);\n}')).toEqual([]);
    expect(unwrapped('export const GET = withRequestLog("/api/x", handleGET);')).toEqual([]);
  });
});
