// Every env name read as process.env.NAME or process.env["NAME"] under src/** (instrumentation*.ts included) must be
// listed in .env.example or in ALLOWLIST below, so a new variable cannot ship without its documented name.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

// Set by the platform or by test tooling, never by a deployer.
const ALLOWLIST: readonly (string | RegExp)[] = [
  "NODE_ENV",
  "NEXT_RUNTIME",
  "CI",
  /^VERCEL_/,
  /^NEXT_PUBLIC_VERCEL_/,
  "AUDIT_WRITE", // npm run audit:interactions tooling
  "AUDIT_DOC_WRITE",
  "SENTRY_SMOKE", // set by npm run sentry:smoke
];

const ENV_READ = /process\.env(?:\.([A-Z][A-Z0-9_]+)|\[\s*["'`]([A-Z][A-Z0-9_]+)["'`]\s*\])/g;

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === "node_modules" ? [] : files(p);
    return /\.(ts|tsx|mts|js|mjs)$/.test(name) ? [p] : [];
  });
}

function envNames(source: string): string[] {
  return [...source.matchAll(ENV_READ)].map((m) => m[1] ?? m[2]);
}

function exampleNames(example: string): Set<string> {
  return new Set([...example.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]));
}

function missingNames(example: Set<string>): string[] {
  const rootInstrumentation = readdirSync(ROOT).filter((n) => /^instrumentation.*\.(ts|tsx)$/.test(n)).map((n) => join(ROOT, n));
  const missing = new Set<string>();
  // This file names process.env reads in comments and fixtures, so it is not scanned.
  const self = join(ROOT, "src", "docs.guard.test.ts");
  for (const file of [...files(join(ROOT, "src")), ...rootInstrumentation].filter((f) => f !== self)) {
    for (const name of envNames(readFileSync(file, "utf8"))) {
      if (!example.has(name) && !allowed(name)) missing.add(`${name} (${file.slice(ROOT.length + 1)})`);
    }
  }
  return [...missing];
}

const allowed = (name: string) => ALLOWLIST.some((a) => (typeof a === "string" ? a === name : a.test(name)));

describe("docs guard: env names", () => {
  it("parses literal and bracket reads", () => {
    expect(envNames(`a(process.env.SENTRY_DSN); b(process.env["CRON_SECRET"]); c(process.env[key]); // process.env.X`))
      .toEqual(["SENTRY_DSN", "CRON_SECRET"]);
  });

  it(".env.example values are empty", () => {
    const lines = readFileSync(join(ROOT, ".env.example"), "utf8").split("\n").filter((l) => /^[A-Z]/.test(l));
    expect(lines.filter((l) => !/^[A-Z][A-Z0-9_]*=$/.test(l))).toEqual([]);
  });

  it("every .env.example name has a one-line comment right above it", () => {
    const lines = readFileSync(join(ROOT, ".env.example"), "utf8").split("\n");
    const bare = lines.filter((l, i) => /^[A-Z]/.test(l) && !lines[i - 1]?.startsWith("# "));
    expect(bare).toEqual([]);
  });

  it("every process.env name under src/** is in .env.example or the allowlist", () => {
    const example = exampleNames(readFileSync(join(ROOT, ".env.example"), "utf8"));
    expect(missingNames(example)).toEqual([]);
  });

  it("fails when a name is removed from .env.example", () => {
    const example = exampleNames(readFileSync(join(ROOT, ".env.example"), "utf8"));
    example.delete("SENTRY_DSN");
    expect(missingNames(example).some((m) => m.startsWith("SENTRY_DSN "))).toBe(true);
  });

  it("names the documented env reads and keeps desktop release secrets out", () => {
    const example = exampleNames(readFileSync(join(ROOT, ".env.example"), "utf8"));
    for (const name of ["SENTRY_DSN", "NEXT_PUBLIC_SENTRY_DSN", "STORE_ALL_FRAMES", "USAGE_EVENTS", "SUPABASE_TEST_URL",
      "SUPABASE_TEST_ANON_KEY", "SUPABASE_TEST_SERVICE_ROLE_KEY", "SUPABASE_TEST_ALLOWED_HOST"]) {
      expect(example.has(name), name).toBe(true);
    }
    expect([...example].filter((n) => /^(CSC_|APPLE_API_|GH_TOKEN|DESKTOP_RELEASE_)/.test(n))).toEqual([]);
  });
});
