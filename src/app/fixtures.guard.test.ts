// Demo residue cleanup (T-0289): preview and __audit routes are local-mode dev tools. Every page under
// src/app/**/preview/** and src/app/__audit/** imports fixturesEnabled() and calls notFound() when it is false.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fixturesEnabled } from "@/lib/fixtures/enabled";

const APP = join(__dirname);
const PAGE = /^page\.(tsx|ts|jsx|js)$/;

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walk(full) : [full];
  });
}

const rel = (f: string) => relative(APP, f).split("\\").join("/");
const guarded = (f: string) => /(^|\/)preview(\/|$)/.test(rel(f)) || rel(f).startsWith("__audit/");
const pages = walk(APP).filter((f) => PAGE.test(f.split(/[\\/]/).pop() ?? "") && guarded(f));

describe("preview and __audit pages", () => {
  it("finds the preview pages (including the (app)/preview shell)", () => {
    const names = pages.map(rel);
    expect(names.length).toBeGreaterThanOrEqual(12);
    expect(names).toContain("(app)/preview/shell/page.tsx");
    expect(names).toContain("login/preview/page.tsx");
  });

  it.each(pages.map((f) => [rel(f), f]))("%s imports fixturesEnabled and calls notFound when it is false", (_, f) => {
    const src = readFileSync(f, "utf8");
    expect(src).toMatch(/^import \{ fixturesEnabled \} from "@\/lib\/fixtures\/enabled";$/m);
    expect(src).toMatch(/^import \{ notFound \} from "next\/navigation";$/m);
    expect(src).toMatch(/if \(!fixturesEnabled\(\)\) notFound\(\);/);
    expect(src).not.toMatch(/appMode\(\)/);
  });

  it("__audit is a private folder with no page (never routed, so 404 in every mode)", () => {
    const audit = walk(join(APP, "__audit"));
    expect(audit.filter((f) => PAGE.test(f.split(/[\\/]/).pop() ?? ""))).toEqual([]);
  });
});

describe("fixturesEnabled", () => {
  afterEach(() => vi.unstubAllEnvs());
  const env = (mode: string, url = "", anon = "", service = "") => {
    vi.stubEnv("NODE_ENV", mode);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", url);
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", anon);
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", service);
  };

  it("on in local mode outside production", () => {
    env("development");
    expect(fixturesEnabled()).toBe(true);
    env("test");
    expect(fixturesEnabled()).toBe(true);
  });

  it("off when NODE_ENV is production", () => {
    env("production");
    expect(fixturesEnabled()).toBe(false);
    env("production", "https://x.supabase.co", "anon", "service");
    expect(fixturesEnabled()).toBe(false);
  });

  it("off when appMode is not local (supabase or misconfigured)", () => {
    env("development", "https://x.supabase.co", "anon", "service");
    expect(fixturesEnabled()).toBe(false);
    env("development", "https://x.supabase.co");
    expect(fixturesEnabled()).toBe(false);
  });
});
