// Lint for the cost meter migration and its rollback (docs/checks/cost-meter.md). No database.
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const UP = path.join(process.cwd(), "supabase/migrations/20261006000000_usage_events.sql");
const DOWN = path.join(process.cwd(), "supabase/rollbacks/20261006000000_usage_events.down.sql");

// Comments out, whitespace collapsed, lower case, split on ';'.
const statements = (sql: string) =>
  sql
    .replace(/--[^\n]*/g, "")
    .toLowerCase()
    .split(";")
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean);

const up = statements(readFileSync(UP, "utf8"));
const down = statements(readFileSync(DOWN, "utf8"));
const upText = up.join(";\n");

describe("usage_events migration", () => {
  it("creates the view with security_invoker = true and the Europe/Zurich day", () => {
    const view = up.find((s) => s.startsWith("create view public.usage_cost_daily"));
    expect(view).toBeDefined();
    expect(view).toContain("with (security_invoker = true)");
    expect(view).toContain("(e.created_at at time zone 'europe/zurich')::date as day");
    expect(view).toContain("as unpriced_events");
    expect(view).toContain("left join lateral");
  });

  it("names the three select policies, all to authenticated, members only on usage_events", () => {
    const policies = up.filter((s) => s.startsWith("create policy "));
    expect(policies.map((s) => s.split(" ")[2]).sort()).toEqual(["model_prices_select", "usage_events_select", "voice_prices_select"]);
    for (const p of policies) expect(p).toMatch(/ for select to authenticated using /);
    expect(policies.find((s) => s.includes("usage_events_select"))).toContain("using (public.is_workspace_member(workspace_id))");
  });

  it("revokes from public and anon and grants select only", () => {
    for (const t of ["usage_events", "model_prices", "voice_prices", "usage_cost_daily"]) {
      expect(up).toContain(`revoke all on table public.${t} from public, anon`);
      expect(up).toContain(`grant select on table public.${t} to authenticated`);
    }
    expect(up.filter((s) => s.startsWith("grant ") && !s.startsWith("grant select on "))).toEqual([]);
  });

  it("has no insert, update, delete or all policy on usage_events", () => {
    const writes = up.filter((s) => /^create policy \S+ on public\.usage_events\b/.test(s) && !/ for select /.test(s));
    expect(writes).toEqual([]);
  });

  it("enables RLS on every table", () => {
    for (const t of ["usage_events", "model_prices", "voice_prices"])
      expect(up).toContain(`alter table public.${t} enable row level security`);
  });

  it("has the per-workspace partial unique index on voice tokens and the created_at index", () => {
    expect(up).toContain(
      "create unique index usage_events_voice_token on public.usage_events (workspace_id, session_id) where kind = 'voice'",
    );
    expect(up).toContain("create index usage_events_ws_created on public.usage_events (workspace_id, created_at desc)");
  });

  it("drops every created table, view, index and policy in the rollback, the view first", () => {
    const created = [...upText.matchAll(/\bcreate (?:unique )?(table|view|index|policy) (?:if not exists )?(?:public\.)?(\w+)/g)].map(
      (m) => ({ type: m[1], name: m[2] }),
    );
    expect(created.length).toBe(9);
    for (const { type, name } of created) {
      const dropped = down.some((s) => new RegExp(`^drop ${type} if exists (?:public\\.)?${name}\\b`).test(s));
      expect(dropped, `${type} ${name}`).toBe(true);
    }
    expect(down[0]).toBe("drop view if exists public.usage_cost_daily");
    expect(down.every((s) => s.startsWith("drop "))).toBe(true);
    expect(readFileSync(DOWN, "utf8").toLowerCase()).toContain("destroys billing history");
  });
});
