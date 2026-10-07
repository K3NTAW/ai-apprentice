// Guard for the CI workflows (T-0352): ci.yml, db-tests.yml, and the shared checks on nightly-live.yml.
// No YAML parser in the deps, so these are string checks on the files, like live-nightly.guard.test.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (p: string) => fs.readFileSync(path.join(root, p), "utf8");
const ci = read(".github/workflows/ci.yml");
const db = read(".github/workflows/db-tests.yml");
const nightly = read(".github/workflows/nightly-live.yml");
const usesLines = (yml: string) => yml.split("\n").filter((l) => /^\s*-?\s*uses:/.test(l));
const PINNED = /uses: [\w.-]+\/[\w./-]+@[0-9a-f]{40}\s+# v\d+(\.\d+){0,2}\s*$/;

describe.each([
  ["ci.yml", ci],
  ["db-tests.yml", db],
])("%s", (_name, yml) => {
  it("pins every action to a full commit SHA with the tag in a comment", () => {
    const uses = usesLines(yml);
    expect(uses.length).toBeGreaterThan(0);
    for (const l of uses) expect(l, l).toMatch(PINNED);
  });

  it("uses node-version '22'", () => {
    expect(yml).toContain("node-version: '22'");
  });

  it("has permissions contents: read, concurrency and timeout-minutes", () => {
    expect(yml).toMatch(/^permissions:\s*\n {2}contents: read\s*$/m);
    expect(yml).not.toMatch(/:\s*write\b/);
    expect(yml).toContain("concurrency:");
    expect(yml).toContain("timeout-minutes:");
  });

  it("runs on push and pull_request", () => {
    expect(yml).toMatch(/^on:\s*\n {2}push:\s*\n {2}pull_request:/m);
  });
});

describe("ci.yml", () => {
  it("runs lint, typecheck and npm test in job ci within 15 minutes", () => {
    expect(ci).toMatch(/^ {2}ci:\s*$/m);
    expect(ci).toContain("group: ci-${{ github.ref }}");
    expect(ci).toContain("cancel-in-progress: true");
    expect(ci).toContain("timeout-minutes: 15");
    for (const s of ["run: npm ci", "run: npm run lint", "run: npm run typecheck", "run: npm test"]) expect(ci).toContain(s);
  });
});

describe("db-tests.yml", () => {
  const lines = db.split("\n");
  const firstIndex = (re: RegExp) => lines.findIndex((l) => re.test(l));

  it("runs test:db with REQUIRE_DB=1 against supabase start only", () => {
    expect(db).toMatch(/^ {2}db-tests:\s*$/m);
    expect(db).toContain("group: db-tests-${{ github.ref }}");
    expect(db).toContain("timeout-minutes: 20");
    expect(db).toContain("run: supabase start");
    expect(db).toContain("supabase status -o env");
    expect(db).toMatch(/REQUIRE_DB=1 npm run test:db/);
    expect(firstIndex(/supabase start/)).toBeLessThan(firstIndex(/test:db/));
  });

  it("pins the Supabase CLI to an exact version", () => {
    expect(db).toMatch(/supabase\/setup-cli@[0-9a-f]{40}[^\n]*\n\s+with:\s*\n\s+version: \d+\.\d+\.\d+\s*$/m);
  });

  it("masks every value before writing it to GITHUB_ENV and fails when one is empty", () => {
    const env = firstIndex(/GITHUB_ENV/);
    expect(env).toBeGreaterThan(-1);
    for (const v of ["url", "anon", "service"]) {
      const mask = firstIndex(new RegExp(`::add-mask::\\$${v}\\b`));
      expect(mask, v).toBeGreaterThan(-1);
      expect(mask, v).toBeLessThan(env);
    }
    for (const k of ["API_URL", "ANON_KEY", "SERVICE_ROLE_KEY"]) expect(db).toContain(`^${k}=`);
    for (const k of ["SUPABASE_TEST_URL", "SUPABASE_TEST_ANON_KEY", "SUPABASE_TEST_SERVICE_ROLE_KEY"]) {
      expect(db).toContain(`${k}=$`);
    }
    expect(db).toMatch(/-z "\$url" \] \|\| \[ -z "\$anon" \] \|\| \[ -z "\$service" \][\s\S]*?exit 1/);
  });

  it("references no secrets and no hosted project", () => {
    expect(db).not.toContain("secrets.");
    expect(db).not.toMatch(/supabase\.co|SUPABASE_TEST_ALLOWED_HOST|supabase link/);
  });

  it("stops the stack in an always() step", () => {
    expect(db).toMatch(/if: always\(\)\s*\n\s+run: supabase stop/);
  });
});

describe("nightly-live.yml (shared checks)", () => {
  it("has permissions, concurrency and timeout-minutes", () => {
    for (const k of ["permissions:", "concurrency:", "timeout-minutes:"]) expect(nightly).toContain(k);
  });

  it("uses node 22", () => {
    expect(nightly).toMatch(/node-version: '?22'?\s*$/m);
  });

  // nightly-live.yml still uses tag refs (@v4, @v7); pinning it is outside T-0352's write scope. Follow-up task.
  it.todo("pins every action to a full commit SHA");
});

describe("vitest wiring", () => {
  it("keeps db-tests out of the root include", () => {
    const config = read("vitest.config.ts");
    const include = config.match(/include:\s*\[([^\]]*)\]/);
    expect(include).not.toBeNull();
    const globs = [...include![1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    expect(globs.length).toBeGreaterThan(0);
    for (const g of globs) expect(g.startsWith("db-tests") || g.startsWith("**"), g).toBe(false);
    expect(globs).toContain("e2e/*.guard.test.ts");
  });

  it("points test:db at db-tests/vitest.config.ts", () => {
    const pkg = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    expect(pkg.scripts["test:db"]).toMatch(/-c db-tests\/vitest\.config\.ts\b/);
  });
});
