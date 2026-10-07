import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { POLICY_MATRIX, tablesInSql } from "./matrix";

const dir = new URL("../supabase/migrations/", import.meta.url);
const migrations = readdirSync(dir)
  .filter((f) => f.endsWith(".sql"))
  .sort()
  .map((f) => readFileSync(new URL(f, dir), "utf8"));

const tables = (sql: string[]) => new Set(sql.flatMap(tablesInSql));
const unmapped = (names: Set<string>) => [...names].filter((t) => !(t in POLICY_MATRIX)).sort();
const keys = Object.keys(POLICY_MATRIX).sort();

describe("policy matrix covers every migration table", () => {
  it("parses create table with and without if not exists", () => {
    expect(tablesInSql("create table public.a (x int);\nCREATE TABLE IF NOT EXISTS public.b_2 (\n")).toEqual(["a", "b_2"]);
    expect(tablesInSql("create table private.c (x int); -- create index on public.d")).toEqual([]);
  });

  it("the table set equals the matrix keys", () => {
    expect(migrations.length).toBeGreaterThan(0);
    expect([...tables(migrations)].sort()).toEqual(keys);
  });

  it("a new table without a matrix entry fails", () => {
    const fixture = [...migrations, "create table if not exists public.rls_new_table (id uuid primary key);"];
    expect(unmapped(tables(fixture))).toEqual(["rls_new_table"]);
    expect([...tables(fixture)].sort()).not.toEqual(keys);
  });
});
