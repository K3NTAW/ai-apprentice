// Static lint over the Supabase migrations and their rollbacks. No network, no database.
// This is a lint, it does not replace docs/checks/launch-foundation.md.
import { readdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AVATAR_FACES, AVATAR_SHAPES } from "@/lib/types";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATIONS = path.join(ROOT, "supabase/migrations");
const ROLLBACKS = path.join(ROOT, "supabase/rollbacks");
const INIT = "20261003000000_init.sql";

// ---------------------------------------------------------------------------
// Scanner
// ---------------------------------------------------------------------------

type Seg =
  | { kind: "code" | "line" | "block" | "string"; text: string }
  | { kind: "dollar"; text: string; tag: string; body: string; closed: boolean };

const DOLLAR_TAG = /\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/y;

function scan(sql: string): Seg[] {
  const segs: Seg[] = [];
  const n = sql.length;
  let buf = "";
  let i = 0;
  const flush = () => {
    if (buf) segs.push({ kind: "code", text: buf });
    buf = "";
  };
  while (i < n) {
    const c = sql[i];
    if (c === "-" && sql[i + 1] === "-") {
      flush();
      const end = sql.indexOf("\n", i);
      const j = end === -1 ? n : end;
      segs.push({ kind: "line", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "/" && sql[i + 1] === "*") {
      flush();
      const end = sql.indexOf("*/", i + 2);
      const j = end === -1 ? n : end + 2;
      segs.push({ kind: "block", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "'") {
      flush();
      let j = i + 1;
      while (j < n) {
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          j++;
          break;
        }
        j++;
      }
      segs.push({ kind: "string", text: sql.slice(i, j) });
      i = j;
      continue;
    }
    if (c === "$" && !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? "")) {
      DOLLAR_TAG.lastIndex = i;
      const m = DOLLAR_TAG.exec(sql);
      if (m) {
        flush();
        const tag = m[0];
        const start = i + tag.length;
        const end = sql.indexOf(tag, start);
        const closed = end !== -1;
        const bodyEnd = closed ? end : n;
        const j = closed ? end + tag.length : n;
        segs.push({ kind: "dollar", text: sql.slice(i, j), tag, body: sql.slice(start, bodyEnd), closed });
        i = j;
        continue;
      }
    }
    buf += c;
    i++;
  }
  flush();
  return segs;
}

function stripComments(sql: string): string {
  return scan(sql)
    .map((s) => {
      if (s.kind === "line") return "";
      if (s.kind === "block") return " ";
      if (s.kind === "dollar") return s.tag + stripComments(s.body) + (s.closed ? s.tag : "");
      return s.text;
    })
    .join("");
}

function commentText(sql: string): string {
  return scan(sql)
    .filter((s) => s.kind === "line" || s.kind === "block")
    .map((s) => s.text)
    .join("\n");
}

function splitStatements(sql: string): string[] {
  const out: string[] = [];
  let cur = "";
  for (const s of scan(sql)) {
    if (s.kind !== "code") {
      cur += s.text;
      continue;
    }
    const parts = s.text.split(";");
    cur += parts[0];
    for (const p of parts.slice(1)) {
      out.push(cur);
      cur = p;
    }
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

// Statements with comments removed, plus the statements inside every dollar-quoted body.
function deepStatements(sql: string): string[] {
  const out: string[] = [];
  for (const stmt of splitStatements(stripComments(sql))) {
    out.push(stmt);
    for (const body of dollarBodies(stmt)) out.push(...deepStatements(body));
  }
  return out;
}

function dollarBodies(stmt: string): string[] {
  return scan(stmt).flatMap((s) => (s.kind === "dollar" ? [s.body] : []));
}

function headerOf(stmt: string): string {
  return scan(stmt)
    .map((s) => (s.kind === "dollar" ? "$$" : s.text))
    .join("");
}

function norm(s: string): string {
  return s
    .replace(/"([^"]*)"/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

function compact(s: string): string {
  return norm(s).replace(/\s*([(),])\s*/g, "$1");
}

// Index of the paren closing the one at `open`, skipping single-quoted strings. -1 if none.
function matchParen(s: string, open: number): number {
  let depth = 0;
  for (let j = open; j < s.length; j++) {
    const c = s[j];
    if (c === "'") {
      j++;
      while (j < s.length && !(s[j] === "'" && s[j + 1] !== "'")) j += s[j] === "'" ? 2 : 1;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")" && --depth === 0) return j;
  }
  return -1;
}

function splitTopLevel(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let inStr = false;
  let cur = "";
  for (const c of s) {
    if (c === "'") inStr = !inStr;
    else if (!inStr && c === "(") depth++;
    else if (!inStr && c === ")") depth--;
    if (!inStr && depth === 0 && c === ",") {
      out.push(cur.trim());
      cur = "";
    } else cur += c;
  }
  out.push(cur.trim());
  return out;
}

// ---------------------------------------------------------------------------
// Parsers
// ---------------------------------------------------------------------------

type Policy = {
  name: string;
  table: string;
  command: string;
  roles: string[];
  using?: string;
  withCheck?: string;
};

// The expressions of a policy are only the text inside using ( ... ) and with check ( ... ).
function policyClauses(rest: string): { head: string; using?: string; withCheck?: string } {
  let head: string | undefined;
  let using: string | undefined;
  let withCheck: string | undefined;
  let depth = 0;
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === "'") {
      i = rest.indexOf("'", i + 1);
      if (i === -1) break;
      continue;
    }
    if (c === "(") depth++;
    if (c === ")") depth--;
    if (depth !== 0 || /[a-z0-9_]/.test(rest[i - 1] ?? "")) continue;
    const m = /^(using|with check)\s*\(/.exec(rest.slice(i));
    if (!m) continue;
    const open = i + m[0].length - 1;
    const close = matchParen(rest, open);
    if (close === -1) break;
    head ??= rest.slice(0, i);
    const inner = rest.slice(open + 1, close);
    if (m[1] === "using") using = inner;
    else withCheck = inner;
    i = close;
  }
  return { head: head ?? rest, using, withCheck };
}

function parsePolicies(sql: string): Policy[] {
  const out: Policy[] = [];
  for (const stmt of splitStatements(stripComments(sql))) {
    const m = /^create policy (\S+) on (\S+)(.*)$/.exec(norm(stmt));
    if (!m) continue;
    const { head, using, withCheck } = policyClauses(m[3]);
    const command = /\bfor (all|select|insert|update|delete)\b/.exec(head)?.[1] ?? "all";
    const to = /\bto (.+)$/.exec(head)?.[1];
    const roles = to ? to.split(",").map((r) => r.trim()) : ["public"];
    out.push({ name: m[1], table: m[2], command, roles, using, withCheck });
  }
  return out;
}

const exprsOf = (p: Policy) => [p.using, p.withCheck].filter((e): e is string => e !== undefined);

type Fn = { name: string; returns: string; header: string; body: string };

function parseFunctions(sql: string): Fn[] {
  const out: Fn[] = [];
  for (const stmt of splitStatements(stripComments(sql))) {
    const header = norm(headerOf(stmt));
    const m = /^create (?:or replace )?function public\.(\w+)\s*\([^)]*\)\s*returns (?:setof )?(\w+)/.exec(header);
    if (!m) continue;
    out.push({ name: m[1], returns: m[2], header, body: dollarBodies(stmt)[0] ?? "" });
  }
  return out;
}

function parseTables(sql: string): string[] {
  return splitStatements(stripComments(sql)).flatMap((stmt) => {
    const m = /^create table (?:if not exists )?public\.(\w+)/.exec(norm(stmt));
    return m ? [m[1]] : [];
  });
}

function normStatements(sql: string): string[] {
  return splitStatements(stripComments(sql)).map(norm);
}

const roleList = (s: string) => s.split(",").map((r) => r.trim());
const fnNames = (s: string) => [...s.matchAll(/public\.(\w+)\s*\(/g)].map((m) => m[1]);

function parseFunctionPrivileges(sql: string) {
  const revokes: { names: string[]; roles: string[] }[] = [];
  const grants: { names: string[]; all: boolean; roles: string[] }[] = [];
  for (const s of normStatements(sql)) {
    let m = /^revoke (?:all(?: privileges)?|execute) on (?:function|routine)s? (.+?) from (.+?)(?: cascade| restrict)?$/.exec(s);
    if (m) revokes.push({ names: fnNames(m[1]), roles: roleList(m[2]) });
    m = /^grant .+? on (all functions in schema \w+|(?:function|routine)s? .+?) to (.+?)(?: with grant option)?$/.exec(s);
    if (m) grants.push({ names: fnNames(m[1]), all: m[1].startsWith("all "), roles: roleList(m[2]) });
  }
  return { revokes, grants };
}

// ---------------------------------------------------------------------------
// Checks: (sql) -> violations
// ---------------------------------------------------------------------------

function check1Rls(sql: string): string[] {
  const stmts = normStatements(sql);
  return parseTables(sql)
    .filter(
      (t) =>
        !stmts.some((s) =>
          new RegExp(`^alter table (?:if exists )?(?:only )?public\\.${t} enable row level security$`).test(s),
        ),
    )
    .map((t) => `1: public.${t} has no enable row level security`);
}

function check2HasPolicy(sql: string): string[] {
  const policies = parsePolicies(sql);
  return parseTables(sql)
    .filter((t) => !policies.some((p) => p.table === `public.${t}`))
    .map((t) => `2: public.${t} has no policy`);
}

function isTrueAlone(expr: string): boolean {
  let e = compact(expr);
  while (e.startsWith("(") && matchParen(e, 0) === e.length - 1) e = e.slice(1, -1).trim();
  return e === "true";
}

function check3NoTrue(sql: string): string[] {
  return parsePolicies(sql)
    .filter((p) => exprsOf(p).some(isTrueAlone))
    .map((p) => `3: policy ${p.name} has an expression that is true alone`);
}

function check4UpdateEqual(sql: string): string[] {
  const out: string[] = [];
  for (const p of parsePolicies(sql).filter((p) => p.command === "update")) {
    if (p.using === undefined || p.withCheck === undefined) out.push(`4: update policy ${p.name} lacks using or with check`);
    else if (compact(p.using) !== compact(p.withCheck)) out.push(`4: update policy ${p.name} has with check != using`);
  }
  return out;
}

function check5Authenticated(sql: string): string[] {
  return parsePolicies(sql)
    .filter((p) => p.roles.length !== 1 || p.roles[0] !== "authenticated")
    .map((p) => `5: policy ${p.name} is to ${p.roles.join(", ")}`);
}

function check6NoDirectSubselect(sql: string): string[] {
  return parsePolicies(sql)
    .filter((p) => exprsOf(p).some((e) => /public\.(workspace_members|sessions)\b/.test(norm(e))))
    .map((p) => `6: policy ${p.name} references public.workspace_members or public.sessions`);
}

function check7SearchPath(sql: string): string[] {
  return parseFunctions(sql)
    .filter((f) => /\bsecurity definer\b/.test(f.header) && !/\bset search_path\s*(?:=|to)\s*''(?!')/.test(f.header))
    .map((f) => `7: security definer function ${f.name} lacks set search_path = ''`);
}

function check8FunctionGrants(sql: string): string[] {
  const out: string[] = [];
  const { revokes, grants } = parseFunctionPrivileges(sql);
  for (const f of parseFunctions(sql)) {
    const rs = revokes.filter((r) => r.names.includes(f.name));
    if (!rs.some((r) => r.roles.includes("public") && r.roles.includes("anon")))
      out.push(`8: function ${f.name} lacks revoke all ... from public, anon`);
    const gs = grants.filter((g) => g.names.includes(f.name));
    if (f.returns === "trigger") {
      if (!rs.some((r) => r.roles.includes("authenticated")))
        out.push(`8: trigger function ${f.name} is not revoked from authenticated`);
      if (gs.length) out.push(`8: trigger function ${f.name} has a grant`);
    } else if (!gs.some((g) => g.roles.includes("authenticated"))) {
      out.push(`8: function ${f.name} lacks grant execute to authenticated`);
    }
  }
  for (const g of grants)
    if (g.roles.includes("anon") || g.roles.includes("public"))
      out.push(`8: function grant to ${g.roles.join(", ")} on ${g.all ? "all functions" : g.names.join(", ")}`);
  return out;
}

function check9Rollback(sql: string, rollback: string): string[] {
  const out: string[] = [];
  const stmts = deepStatements(rollback).map(norm);
  const droppedTables = new Set<string>();
  const droppedFns = new Set<string>();
  const droppedPolicies = new Set<string>();
  for (const s of stmts) {
    let m = /\bdrop table if exists (.+?)(?: cascade| restrict)?$/.exec(s);
    if (m) for (const t of roleList(m[1])) droppedTables.add(t);
    m = /\bdrop function if exists (.+?)(?: cascade| restrict)?$/.exec(s);
    if (m) for (const f of fnNames(m[1])) droppedFns.add(f);
    m = /\bdrop policy if exists (\S+) on (\S+)/.exec(s);
    if (m) droppedPolicies.add(`${m[1]} on ${m[2]}`);
  }
  const comments = norm(commentText(rollback));
  const policiesGoWithTable = /\bpolic(?:y|ies)\b/.test(comments) && /\btables?\b/.test(comments);
  for (const t of parseTables(sql))
    if (!droppedTables.has(`public.${t}`)) out.push(`9: rollback lacks drop table if exists public.${t}`);
  // A function the migration replaces (create or replace) is handled when the rollback restores it the same way.
  const restoredFns = new Set(parseFunctions(rollback).filter((f) => f.header.startsWith("create or replace ")).map((f) => f.name));
  for (const f of parseFunctions(sql)) {
    if (droppedFns.has(f.name)) continue;
    if (f.header.startsWith("create or replace ") && restoredFns.has(f.name)) continue;
    out.push(`9: rollback lacks drop function if exists public.${f.name}`);
  }
  for (const p of parsePolicies(sql)) {
    if (droppedPolicies.has(`${p.name} on ${p.table}`)) continue;
    if (p.table.startsWith("public.") && droppedTables.has(p.table) && policiesGoWithTable) continue;
    out.push(`9: rollback lacks drop policy if exists ${p.name} on ${p.table}`);
  }
  const all = stmts.join(";\n");
  if (all.includes("storage.buckets")) out.push("9: rollback touches storage.buckets");
  if (/\bdelete from storage\.objects\b/.test(all)) out.push("9: rollback deletes from storage.objects");
  return out;
}

function check10Bucket(sql: string): string[] {
  const inserts = normStatements(sql).filter((s) => s.startsWith("insert into storage.buckets"));
  if (!inserts.length) return ["10: no storage.buckets insert"];
  const out: string[] = [];
  for (const s of inserts) {
    const m = /^insert into storage\.buckets\s*\(([^)]*)\)\s*values\s*\((.*)\)\s*on conflict\s*\(\s*id\s*\)\s*do nothing$/.exec(s);
    if (!m) {
      out.push("10: bucket insert lacks the column list or on conflict (id) do nothing");
      continue;
    }
    const cols = roleList(m[1]);
    if (cols.join(",") !== "id,name,public") out.push(`10: bucket insert columns are ${cols.join(", ")}`);
    else if (splitTopLevel(m[2])[2] !== "false") out.push("10: bucket public is not false");
  }
  return out;
}

function hasCoalescedStartsWith(expr: string): boolean {
  for (const m of expr.matchAll(/\bcoalesce\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const close = matchParen(expr, open);
    if (close !== -1 && /\bstarts_with\s*\(/.test(expr.slice(open, close))) return true;
  }
  return false;
}

function check11StoragePolicies(sql: string): string[] {
  const out: string[] = [];
  const policies = parsePolicies(sql).filter((p) => p.table === "storage.objects");
  if (!policies.length) out.push("11: no storage.objects policy");
  for (const p of policies) {
    for (const raw of exprsOf(p)) {
      const e = norm(raw);
      if (e.includes("::uuid") || /\bcast\s*\(.*\bas uuid\b/.test(e) || e.includes(" like "))
        out.push(`11: storage policy ${p.name} casts to uuid or uses like`);
      if (["insert", "update", "delete"].includes(p.command)) {
        if (!hasCoalescedStartsWith(e)) out.push(`11: storage policy ${p.name} lacks coalesce(starts_with(...))`);
        if (!/\bbucket_id\s*=\s*'frames'/.test(e)) out.push(`11: storage policy ${p.name} lacks bucket_id = 'frames'`);
      }
    }
  }
  return out;
}

type Trigger = { timing: string; events: string[]; table: string };

function parseTriggers(sql: string): Trigger[] {
  return normStatements(sql).flatMap((s) => {
    const m = /^create (?:or replace )?(?:constraint )?trigger \S+ (before|after|instead of) (.+?) on (?:only )?(\S+) /.exec(s);
    return m ? [{ timing: m[1], events: m[2].split(" or ").map((e) => e.split(" ")[0]), table: m[3] }] : [];
  });
}

function check12Triggers(sql: string): string[] {
  const ts = parseTriggers(sql);
  const has = (timing: string, table: string, events: string[]) =>
    ts.some((t) => t.timing === timing && t.table === table && events.every((e) => t.events.includes(e)));
  const need: [string, string, string[]][] = [
    ["before", "public.sessions", ["update"]],
    ["before", "public.workspace_members", ["update"]],
    ["after", "public.workspace_members", ["update", "delete"]],
    ...["session_events", "session_transcript", "session_qa", "session_frames"].map(
      (t): [string, string, string[]] => ["before", `public.${t}`, ["update"]],
    ),
  ];
  return need
    .filter(([timing, table, events]) => !has(timing, table, events))
    .map(([timing, table, events]) => `12: no ${timing} ${events.join(" or ")} trigger on ${table}`);
}

function check13NoMemberInsert(sql: string): string[] {
  return parsePolicies(sql)
    .filter(
      (p) =>
        ["public.workspaces", "public.workspace_members"].includes(p.table) &&
        (p.command === "insert" || p.command === "all"),
    )
    .map((p) => `13: policy ${p.name} allows insert on ${p.table}`);
}

function check14Bootstrap(sql: string): string[] {
  const out: string[] = [];
  const f = parseFunctions(sql).find((x) => x.name === "bootstrap_workspace");
  if (!f) return ["14: no bootstrap_workspace"];
  const first = f.body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
  if (norm(first) !== "#variable_conflict use_column") out.push("14: body does not start with #variable_conflict use_column");
  const body = norm(f.body);
  if (!body.includes("on conflict on constraint workspace_members_pkey do nothing"))
    out.push("14: body lacks on conflict on constraint workspace_members_pkey do nothing");
  if (!body.includes("pg_advisory_xact_lock")) out.push("14: body lacks pg_advisory_xact_lock");
  const members = normStatements(sql).find((s) => /^create table (?:if not exists )?public\.workspace_members\b/.test(s));
  if (!members?.includes("constraint workspace_members_pkey primary key"))
    out.push("14: workspace_members lacks constraint workspace_members_pkey primary key");
  return out;
}

function check15LastOwnerLock(sql: string): string[] {
  const f = parseFunctions(sql).find((x) => x.name === "workspace_members_last_owner_guard");
  if (!f) return ["15: no workspace_members_last_owner_guard"];
  const body = norm(f.body);
  const lock = /\bfrom public\.workspaces\b[^;]*?\bfor update\b/.exec(body);
  const raise = body.search(/\braise\b/);
  return lock && raise !== -1 && lock.index < raise ? [] : ["15: no for update lock on public.workspaces before raise"];
}

const INIT_TABLES = [
  "workspaces",
  "workspace_members",
  "workspace_invites",
  "sessions",
  "session_events",
  "session_transcript",
  "session_qa",
  "session_frames",
];

function check16TableRevokes(sql: string): string[] {
  const revokes = normStatements(sql).flatMap((s) => {
    const m = /^revoke all(?: privileges)? on (?:table )?(.+?) from (.+?)(?: cascade| restrict)?$/.exec(s);
    return m && !/^(function|sequence|routine|schema|all )/.test(m[1])
      ? [{ tables: roleList(m[1]), roles: roleList(m[2]) }]
      : [];
  });
  return INIT_TABLES.filter(
    (t) => !revokes.some((r) => r.tables.includes(`public.${t}`) && r.roles.includes("public") && r.roles.includes("anon")),
  ).map((t) => `16: public.${t} lacks revoke all on table ... from public, anon`);
}

const GENERIC_CHECKS: Record<string, (sql: string) => string[]> = {
  "1 rls enabled": check1Rls,
  "2 at least one policy": check2HasPolicy,
  "3 no true expression": check3NoTrue,
  "4 update using equals with check": check4UpdateEqual,
  "5 to authenticated": check5Authenticated,
  "6 no direct subselect": check6NoDirectSubselect,
  "7 security definer search_path": check7SearchPath,
  "8 function grants": check8FunctionGrants,
};

const INIT_CHECKS: Record<string, (sql: string) => string[]> = {
  "10 frames bucket insert": check10Bucket,
  "11 storage policies": check11StoragePolicies,
  "12 triggers": check12Triggers,
  "13 no insert policy on workspaces or members": check13NoMemberInsert,
  "14 bootstrap_workspace": check14Bootstrap,
  "15 last-owner lock": check15LastOwnerLock,
  "16 table revokes": check16TableRevokes,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("scanner", () => {
  it("ignores an apostrophe in a line comment", () => {
    const sql = "-- don't split here\nselect 1;\nselect 2;";
    expect(splitStatements(sql).map((s) => stripComments(s).trim())).toEqual(["select 1", "select 2"]);
    expect(stripComments(sql)).not.toContain("don't");
  });

  it("ignores an apostrophe in a block comment and an escaped quote in a string", () => {
    const sql = "/* it's; */ select 'a''b;c'; select 2;";
    expect(splitStatements(stripComments(sql))).toEqual(["select 'a''b;c'", "select 2"]);
  });

  it("treats a dollar sign at the end of a string literal as text", () => {
    const sql = "create table t (id text check (id ~ '^[a-zA-Z0-9_-]+$'));\nselect 'x$'; select $$ a; b $$;";
    expect(splitStatements(sql)).toEqual([
      "create table t (id text check (id ~ '^[a-zA-Z0-9_-]+$'))",
      "select 'x$'",
      "select $$ a; b $$",
    ]);
  });

  it("keeps a tagged dollar-quoted body with a semicolon and a comment in one statement", () => {
    const sql = [
      "create function f() returns int language plpgsql as $fn$",
      "#variable_conflict use_column",
      "begin -- it's a comment; really",
      "  perform $$ not a close $$; /* x; */",
      "  return 1;",
      "end",
      "$fn$;",
      "select 2;",
    ].join("\n");
    const stmts = splitStatements(sql);
    expect(stmts).toHaveLength(2);
    expect(stmts[1]).toBe("select 2");
    const stripped = stripComments(stmts[0]);
    expect(stripped).not.toContain("it's");
    expect(stripped).not.toContain("x;");
    expect(stripped).toContain("return 1;");
    expect(dollarBodies(stripped)[0].trim().split("\n")[0]).toBe("#variable_conflict use_column");
  });

  it("keeps a double dash inside a string", () => {
    const sql = "select 'a -- b'; select 2; -- tail";
    expect(stripComments(sql)).toBe("select 'a -- b'; select 2; ");
    expect(splitStatements(stripComments(sql))).toEqual(["select 'a -- b'", "select 2"]);
  });

  it("extracts only the using and with check expressions of a policy", () => {
    const [p] = parsePolicies(
      `create policy "p" on public.t for update to authenticated using ( a = ')(' and (b) ) with check (a = ')(' and (b));`,
    );
    expect(p).toMatchObject({ name: "p", table: "public.t", command: "update", roles: ["authenticated"] });
    expect(compact(p.using!)).toBe(compact(p.withCheck!));
  });
});

const migrationFiles = readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql"));

describe.each(migrationFiles)("migration %s", (file) => {
  const sql = readFileSync(path.join(MIGRATIONS, file), "utf8");
  const rollbackPath = path.join(ROLLBACKS, file.replace(/\.sql$/, ".down.sql"));

  it("has a rollback with the same basename", () => {
    expect(existsSync(rollbackPath)).toBe(true);
  });

  it.each(Object.entries(GENERIC_CHECKS))("check %s", (_name, check) => {
    expect(check(sql)).toEqual([]);
  });

  it("check 9 rollback drops everything and leaves storage alone", () => {
    expect(check9Rollback(sql, readFileSync(rollbackPath, "utf8"))).toEqual([]);
  });

  if (file === INIT) {
    it.each(Object.entries(INIT_CHECKS))("check %s", (_name, check) => {
      expect(check(sql)).toEqual([]);
    });
  }
});

const AGENTS = "20261004000000_agents.sql";

describe("agents migration", () => {
  const sql = readFileSync(path.join(MIGRATIONS, AGENTS), "utf8");
  const rollback = readFileSync(path.join(ROLLBACKS, AGENTS.replace(/\.sql$/, ".down.sql")), "utf8");
  const stmts = normStatements(sql);
  const policy = (name: string) => parsePolicies(sql).find((p) => p.name === name);
  const fnBody = (name: string) => norm(parseFunctions(sql).find((f) => f.name === name)?.body ?? "");

  it("creates public.agents with the contract columns and the (workspace_id, id) key", () => {
    const t = stmts.find((s) => s.startsWith("create table public.agents"));
    expect(t).toBeDefined();
    for (const col of [
      "id uuid primary key default gen_random_uuid()",
      "workspace_id uuid not null references public.workspaces on delete cascade",
      "name text not null check (char_length(name) between 1 and 60)",
      "role text not null check (char_length(role) between 1 and 80)",
      "expert_name text",
      "avatar jsonb not null",
      "created_by uuid references auth.users on delete set null",
      "created_at timestamptz not null default now()",
      "updated_at timestamptz not null default now()",
      "constraint agents_workspace_id_id_key unique (workspace_id, id)",
    ])
      expect(t).toContain(col);
    expect(stmts).toContain("create index agents_workspace_created_idx on public.agents (workspace_id, created_at desc)");
    expect(stmts).toContain("revoke all on table public.agents from public, anon");
  });

  it("enforces the avatar contract with check constraints (keys, enums, colours, size)", () => {
    const t = compact(stmts.find((s) => s.startsWith("create table public.agents"))!);
    for (const c of [
      "constraint agents_avatar_keys check(jsonb_typeof(avatar)= 'object' and avatar ?& array['shape','face','color','accent'] and avatar - array['shape','face','color','accent'] = '{}'::jsonb)",
      "constraint agents_avatar_shape check(jsonb_typeof(avatar -> 'shape')= 'string' and avatar ->> 'shape' in('blob','round','square','pill','bean','star'))",
      "constraint agents_avatar_face check(jsonb_typeof(avatar -> 'face')= 'string' and avatar ->> 'face' in('smile','focus','curious','calm','wink','robot'))",
      // norm lowercases, so A-Fa-f reads a-fa-f here.
      "constraint agents_avatar_colors check(jsonb_typeof(avatar -> 'color')= 'string' and avatar ->> 'color' ~ '^#[0-9a-fa-f]{6}$' and jsonb_typeof(avatar -> 'accent')= 'string' and avatar ->> 'accent' ~ '^#[0-9a-fa-f]{6}$')",
      "constraint agents_avatar_size check(pg_column_size(avatar)<= 1024)",
    ])
      expect(t).toContain(c);
    // The enums in the DB are the enums of AvatarSchema.
    expect(sql).toContain(`in (${AVATAR_SHAPES.map((x) => `'${x}'`).join(", ")})`);
    expect(sql).toContain(`in (${AVATAR_FACES.map((x) => `'${x}'`).join(", ")})`);
    expect(sql).toContain("'^#[0-9A-Fa-f]{6}$'");
  });

  it("links sessions to an agent of the same workspace and nulls the link on agent delete", () => {
    expect(stmts).toContain("alter table public.sessions add column agent_id uuid");
    expect(stmts).toContain(
      "alter table public.sessions add constraint sessions_agent_fkey foreign key (workspace_id, agent_id) references public.agents (workspace_id, id) on delete set null (agent_id)",
    );
  });

  it("has the four agents policies with the role rules", () => {
    expect(policy("agents_select")).toMatchObject({ command: "select", roles: ["authenticated"] });
    expect(compact(policy("agents_select")!.using!)).toBe("public.is_workspace_member(workspace_id)");
    const ins = policy("agents_insert");
    expect(ins).toMatchObject({ command: "insert", roles: ["authenticated"] });
    expect(compact(ins!.withCheck!)).toBe(
      "created_by = auth.uid()and public.workspace_role(workspace_id)in('owner','expert')",
    );
    const upd = policy("agents_update");
    expect(upd).toMatchObject({ command: "update", roles: ["authenticated"] });
    expect(compact(upd!.using!)).toBe("public.workspace_role(workspace_id)in('owner','expert')");
    expect(compact(policy("agents_delete")!.using!)).toBe("public.workspace_role(workspace_id)= 'owner'");
  });

  it("guards agents id, workspace_id, created_by and created_at, and touches updated_at", () => {
    const ts = parseTriggers(sql);
    expect(ts.filter((t) => t.table === "public.agents" && t.timing === "before" && t.events.includes("update"))).toHaveLength(2);
    const guard = fnBody("agents_guard_update");
    for (const col of ["id", "workspace_id", "created_by", "created_at"])
      expect(guard).toContain(`new.${col} is distinct from old.${col}`);
    expect(guard).toContain("new.created_by is null and auth.uid() is null");
    expect(fnBody("agents_touch_updated_at")).toContain("new.updated_at := now()");
  });

  it("replaces sessions_guard_update with the agent_id rule and keeps search_path ''", () => {
    const f = parseFunctions(sql).find((x) => x.name === "sessions_guard_update");
    expect(f?.header).toMatch(/^create or replace function/);
    expect(f?.header).toMatch(/set search_path = ''/);
    expect(norm(f!.body)).toContain("new.agent_id is distinct from old.agent_id and new.agent_id is not null");
  });

  it("rollback uses if exists everywhere, keeps the order and restores the init sessions guard", () => {
    const down = deepStatements(rollback).map(norm);
    for (const s of down.filter((x) => /\bdrop\b/.test(x))) expect(s).toMatch(/\bif exists\b/);
    const at = (re: RegExp) => down.findIndex((s) => re.test(s));
    const policies = at(/drop policy if exists agents_select/);
    const restore = at(/^create or replace function public\.sessions_guard_update/);
    const column = at(/drop column if exists agent_id/);
    const table = at(/^drop table if exists public\.agents$/);
    const fns = at(/^drop function if exists public\.agents_guard_update/);
    expect(policies).toBeGreaterThanOrEqual(0);
    expect([policies, restore, column, table, fns].every((x, i, a) => x >= 0 && (i === 0 || a[i - 1] < x))).toBe(true);
    const restored = parseFunctions(rollback).find((f) => f.name === "sessions_guard_update");
    expect(norm(restored!.body)).not.toContain("agent_id");
    expect(norm(commentText(rollback))).toContain("lossy");
  });
});

describe("negative fixtures", () => {
  it("check 3 flags a true-alone expression", () => {
    expect(check3NoTrue("create policy p on public.t for select to authenticated using (  ( TRUE ) );")).toHaveLength(1);
    expect(check3NoTrue("create policy p on public.t for insert to authenticated with check(true);")).toHaveLength(1);
  });

  it("check 4 flags update policies without equal using and with check", () => {
    expect(check4UpdateEqual("create policy p on public.t for update to authenticated using (a = 1);")).toHaveLength(1);
    expect(
      check4UpdateEqual("create policy p on public.t for update to authenticated using (a = 1) with check (a = 2);"),
    ).toHaveLength(1);
  });

  it("check 5 flags a policy not to authenticated", () => {
    expect(check5Authenticated("create policy p on public.t for select using (a);")).toHaveLength(1);
    expect(check5Authenticated("create policy p on public.t for select to anon, authenticated using (a);")).toHaveLength(1);
  });

  it("check 6 flags a direct subselect of members or sessions", () => {
    expect(
      check6NoDirectSubselect(
        "create policy p on public.t for select to authenticated using (exists (select 1 from public.workspace_members m));",
      ),
    ).toHaveLength(1);
    expect(
      check6NoDirectSubselect(
        'create policy p on public.t for select to authenticated using (sid in (select id from public."sessions"));',
      ),
    ).toHaveLength(1);
  });

  it("check 7 flags a security definer function without an empty search_path", () => {
    expect(
      check7SearchPath("create function public.f() returns int language sql security definer as $$ select 1 $$;"),
    ).toHaveLength(1);
    expect(
      check7SearchPath(
        "create function public.f() returns int language sql security definer set search_path = 'public' as $$ select 1 $$;",
      ),
    ).toHaveLength(1);
  });

  it("check 8 flags missing revokes, missing grants and grants to anon", () => {
    const fn = "create function public.f() returns int language sql as $$ select 1 $$;";
    const trg = "create function public.g() returns trigger language plpgsql as $$ begin return new; end $$;";
    expect(check8FunctionGrants(fn + "grant execute on function public.f() to authenticated;")).toHaveLength(1);
    expect(check8FunctionGrants(fn + "revoke all on function public.f() from public, anon;")).toHaveLength(1);
    expect(
      check8FunctionGrants(
        fn + "revoke all on function public.f() from public, anon; grant execute on function public.f() to authenticated, anon;",
      ),
    ).toHaveLength(1);
    expect(check8FunctionGrants(trg + "revoke all on function public.g() from public, anon;")).toHaveLength(1);
    expect(
      check8FunctionGrants(
        trg + "revoke all on function public.g() from public, anon, authenticated; grant execute on function public.g() to authenticated;",
      ),
    ).toHaveLength(1);
    expect(
      check8FunctionGrants(
        fn + "revoke all on function public.f() from public, anon; grant execute on function public.f() to authenticated;",
      ),
    ).toEqual([]);
  });

  it("check 13 flags an insert policy on workspaces or workspace_members", () => {
    expect(
      check13NoMemberInsert("create policy p on public.workspace_members for insert to authenticated with check (a);"),
    ).toHaveLength(1);
    expect(check13NoMemberInsert("create policy p on public.workspaces to authenticated using (a);")).toHaveLength(1);
  });

  it("check 9 flags a rollback that misses objects or touches storage", () => {
    const sql =
      "create table public.t (id int); create function public.f() returns int language sql as $$ select 1 $$;" +
      "create policy p on storage.objects for select to authenticated using (a);";
    expect(check9Rollback(sql, "delete from storage.objects; delete from storage.buckets;")).toHaveLength(5);
  });
});

describe("agent settings migration", () => {
  const FILE = "20261004010000_agent_settings.sql";
  const sql = readFileSync(path.join(MIGRATIONS, FILE), "utf8");
  const rollback = readFileSync(path.join(ROLLBACKS, FILE.replace(/\.sql$/, ".down.sql")), "utf8");
  const stmts = normStatements(sql);
  const policy = (name: string) => parsePolicies(sql).find((p) => p.name === name);
  const check = norm(stmts.find((s) => s.includes("add constraint agents_settings_check")) ?? "");

  it("adds agents.settings jsonb not null default '{}' with a CHECK on keys, types and ranges", () => {
    expect(stmts).toContain("alter table public.agents add column settings jsonb not null default '{}'::jsonb");
    for (const key of ["question_interval_s", "guardrails_first", "learn_shortcuts", "voice_preset", "voice_speed", "redact_names_emails", "redact_iban_phone", "off_record_phrase", "retention_days"])
      expect(check).toContain(`'${key}'`);
    expect(check).toContain("jsonb_typeof(settings) = 'object'");
    expect(check).toContain("in (20, 60, 120, 180, 300)");
    expect(check).toContain("in ('calm', 'neutral', 'energetic')");
    expect(check).toContain("between 0.8 and 1.2");
    expect(check).toContain("in (7, 30, 90, 365)");
    expect(check).toMatch(/\{1,40\}/);
  });

  it("mirrors the shared schema in src/lib/agents/settings.ts", async () => {
    const s = await import("@/lib/agents/settings");
    expect(check).toContain(`in (${s.QUESTION_INTERVALS_S.join(", ")})`);
    expect(check).toContain(`in (${s.RETENTION_DAYS.join(", ")})`);
    expect(check).toContain(`between ${s.VOICE_SPEED_MIN} and ${s.VOICE_SPEED_MAX}`);
    expect(check).toContain(`{1,${s.OFF_RECORD_MAX}}`);
    for (const key of s.SETTINGS_KEYS) expect(check).toContain(`'${key}'`);
  });

  it("agent_deletion_requests: members read, members insert pending for themselves, owners update", () => {
    expect(policy("agent_deletion_requests_select")).toMatchObject({ command: "select", roles: ["authenticated"] });
    const ins = policy("agent_deletion_requests_insert");
    expect(ins).toMatchObject({ command: "insert", roles: ["authenticated"] });
    const wc = norm(ins?.withCheck ?? "");
    for (const part of ["requested_by = auth.uid()", "public.is_workspace_member(workspace_id)", "status = 'pending'", "decided_by is null", "decided_at is null"])
      expect(wc).toContain(part);
    const upd = policy("agent_deletion_requests_update");
    expect(upd).toMatchObject({ command: "update", roles: ["authenticated"] });
    expect(norm(upd?.using ?? "")).toBe("public.workspace_role(workspace_id) = 'owner'");
    expect(norm(upd?.withCheck ?? "")).toBe(norm(upd?.using ?? ""));
    expect(policy("agent_deletion_requests_delete")).toBeUndefined();
    expect(policy("agent_reports_select")).toMatchObject({ command: "select", roles: ["authenticated"] });
    expect(parsePolicies(sql).filter((p) => p.table === "public.agent_reports").map((p) => p.command)).toEqual(["select"]);
  });

  it("ties decided_* to the status, keeps one pending request per agent and sets the agent link null on delete", () => {
    const table = norm(stmts.find((s) => s.startsWith("create table public.agent_deletion_requests")) ?? "");
    expect(table).toContain("(status = 'pending' and decided_by is null and decided_at is null) or (status <> 'pending' and decided_at is not null)");
    expect(table).toContain("references public.agents (workspace_id, id) on delete set null (agent_id)");
    expect(table).toContain("agent_name text not null");
    expect(stmts).toContain("create unique index agent_deletion_requests_pending_key on public.agent_deletion_requests (agent_id) where status = 'pending'");
  });

  it("guards owner updates with a trigger: decision only, once, by the caller", () => {
    const body = norm(parseFunctions(sql).find((f) => f.name === "agent_deletion_requests_guard_update")?.body ?? "");
    expect(body).toContain("old.status <> 'pending'");
    expect(body).toContain("new.decided_by is distinct from auth.uid()");
    expect(body).toContain("new.agent_id is not null");
    expect(stmts.some((s) => s.startsWith("create trigger agent_deletion_requests_guard_update_trg before update on public.agent_deletion_requests"))).toBe(true);
  });

  it("merges settings through a security invoker function", () => {
    const fn = parseFunctions(sql).find((f) => f.name === "agent_settings_patch");
    expect(fn?.header).toContain("security invoker");
    expect(norm(fn?.body ?? "")).toContain("set settings = settings || p_patch");
  });

  it("rollback drops the settings column, both tables and both functions", () => {
    expect(check9Rollback(sql, rollback)).toEqual([]);
    const r = normStatements(rollback);
    expect(r).toContain("alter table if exists public.agents drop column if exists settings");
    expect(norm(commentText(rollback))).toContain("drops every stored agent setting");
  });
});
