import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSupabaseAdminClient } from "./admin";

const VARS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
] as const;

describe("createSupabaseAdminClient", () => {
  let saved: NodeJS.ProcessEnv;
  beforeEach(() => {
    saved = { ...process.env };
    process.env.NEXT_PUBLIC_SUPABASE_URL = "http://localhost:54321";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-placeholder";
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-placeholder";
  });
  afterEach(() => {
    process.env = saved;
    delete (globalThis as { window?: unknown }).window;
  });

  it("throws in a browser-like global", () => {
    (globalThis as { window?: unknown }).window = {};
    expect(() => createSupabaseAdminClient()).toThrow("supabase_admin_in_browser");
  });

  it("throws without env", () => {
    for (const k of VARS) delete process.env[k];
    expect(() => createSupabaseAdminClient()).toThrow("supabase_not_configured");
  });

  it("throws when only the service role key is missing", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = " ";
    expect(() => createSupabaseAdminClient()).toThrow("supabase_not_configured");
  });
});

// Static guard. Known limit: checks direct imports only, no transitive import graph.
describe("'use client' files do not import the admin module", () => {
  const srcDir = fileURLToPath(new URL("../..", import.meta.url));

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return name === "node_modules" ? [] : walk(path);
      return /\.tsx?$/.test(name) ? [path] : [];
    });
  }

  function isUseClient(source: string): boolean {
    const stripped = source.replace(/^﻿/, "").replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
    return /^(['"])use client\1/.test(stripped);
  }

  const specifier = /(?:from\s*|import\s*\(\s*|import\s+|require\s*\(\s*)(['"])([^'"]+)\1/g;

  it("finds no direct imports ending in supabase/admin", () => {
    const offenders: string[] = [];
    for (const file of walk(srcDir)) {
      const source = readFileSync(file, "utf8");
      if (!isUseClient(source)) continue;
      for (const m of source.matchAll(specifier)) {
        if (/supabase\/admin(\.ts)?$/.test(m[2])) offenders.push(`${relative(srcDir, file)}: ${m[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
