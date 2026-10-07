// RLS suite against a real database: the Supabase CLI local stack, never a hosted project unless its host is named in
// SUPABASE_TEST_ALLOWED_HOST. Two users A and B each get a workspace seeded per db-tests/matrix.ts; A then attacks
// every table, RPC and the frames bucket with B's real ids. See docs/checks/db-tests.md.
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { POLICY_MATRIX, RPC_MATRIX, framePath, sessionId, type Category, type Ctx } from "./matrix";

export type Target = { kind: "skip" } | { kind: "run"; url: string; anonKey: string; serviceKey: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

// Decides whether the suite may run. Throws before any user is created when the target is not allowed.
export function resolveTarget(env: Record<string, string | undefined>): Target {
  const raw = (env.SUPABASE_TEST_URL ?? "").trim();
  if (!raw) {
    if (env.REQUIRE_DB === "1") throw new Error("REQUIRE_DB=1 but SUPABASE_TEST_URL is unset");
    return { kind: "skip" };
  }
  let host: string;
  try {
    host = new URL(raw).hostname;
  } catch {
    throw new Error("SUPABASE_TEST_URL is not a valid URL");
  }
  const allowed = (env.SUPABASE_TEST_ALLOWED_HOST ?? "").trim();
  if (!LOCAL_HOSTS.has(host) && !(allowed !== "" && host === allowed)) {
    throw new Error(`refusing SUPABASE_TEST_URL host ${host}: only localhost, 127.0.0.1 or SUPABASE_TEST_ALLOWED_HOST`);
  }
  const anonKey = (env.SUPABASE_TEST_ANON_KEY ?? "").trim();
  const serviceKey = (env.SUPABASE_TEST_SERVICE_ROLE_KEY ?? "").trim();
  if (!anonKey || !serviceKey) throw new Error("SUPABASE_TEST_ANON_KEY and SUPABASE_TEST_SERVICE_ROLE_KEY are required");
  return { kind: "run", url: raw, anonKey, serviceKey };
}

describe("target guard", () => {
  const keys = { SUPABASE_TEST_ANON_KEY: "anon", SUPABASE_TEST_SERVICE_ROLE_KEY: "service" };

  it("skips without a URL and fails with REQUIRE_DB=1", () => {
    expect(resolveTarget({})).toEqual({ kind: "skip" });
    expect(() => resolveTarget({ REQUIRE_DB: "1" })).toThrow(/REQUIRE_DB/);
  });

  it("accepts localhost and 127.0.0.1", () => {
    expect(resolveTarget({ SUPABASE_TEST_URL: "http://127.0.0.1:54621", ...keys }).kind).toBe("run");
    expect(resolveTarget({ SUPABASE_TEST_URL: "http://localhost:54621", ...keys }).kind).toBe("run");
  });

  it("refuses a non-local host unless it equals SUPABASE_TEST_ALLOWED_HOST", () => {
    const url = "https://abcdefgh.supabase.co";
    expect(() => resolveTarget({ SUPABASE_TEST_URL: url, ...keys })).toThrow(/refusing/);
    expect(() => resolveTarget({ SUPABASE_TEST_URL: url, SUPABASE_TEST_ALLOWED_HOST: "other.supabase.co", ...keys })).toThrow(/refusing/);
    expect(() => resolveTarget({ SUPABASE_TEST_URL: "http://localhost.evil.test", ...keys })).toThrow(/refusing/);
    expect(resolveTarget({ SUPABASE_TEST_URL: url, SUPABASE_TEST_ALLOWED_HOST: "abcdefgh.supabase.co", ...keys }).kind).toBe("run");
  });

  it("requires both keys", () => {
    expect(() => resolveTarget({ SUPABASE_TEST_URL: "http://127.0.0.1:54621" })).toThrow(/required/);
  });
});

let target: Target | undefined;
let targetError: unknown;
try {
  target = resolveTarget(process.env);
} catch (e) {
  targetError = e;
}

describe("database target", () => {
  it("is local or explicitly allowed", () => {
    if (targetError) throw targetError;
    if (target?.kind === "skip") console.log("SKIPPED: SUPABASE_TEST_URL unset");
  });
});

type Row = Record<string, unknown>;
type Result = { data: unknown; error: { code?: string; message: string } | null };
type User = { client: SupabaseClient; ctx: Ctx };

const tablesIn = (c: Category) => Object.keys(POLICY_MATRIX).filter((t) => POLICY_MATRIX[t].category === c);
const pick = (row: Row, cols: string[]) => Object.fromEntries(cols.map((c) => [c, row[c]]));
const rowsLen = (data: unknown) => (Array.isArray(data) ? data.length : data == null ? 0 : 1);

// Denied: RLS or a missing grant (42501), or no row affected. Any other error (unknown column, missing function)
// would hide a broken test, so it fails.
function expectDenied(res: Result, what: string) {
  if (res.error) expect(res.error.code, `${what}: ${res.error.message}`).toBe("42501");
  else expect(rowsLen(res.data), what).toBe(0);
}

describe.runIf(target?.kind === "run")("rls against the local stack", () => {
  const run = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const opts = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
  const created = { userIds: [] as string[], ws: new Set<string>(), sids: [sessionId(run, "a"), sessionId(run, "b")] };
  const snapshot: Record<string, Row[]> = {};
  let admin: SupabaseClient;
  let anon: SupabaseClient;
  let A: User;
  let B: User;

  const scopeValue = (table: string, c: Ctx) => c[POLICY_MATRIX[table].scope!.from];

  async function rowsOf(db: SupabaseClient, table: string, c?: Ctx): Promise<Row[]> {
    const e = POLICY_MATRIX[table];
    let q = db.from(table).select("*");
    if (c) q = q.eq(e.scope!.column, scopeValue(table, c));
    for (const k of e.key) q = q.order(k);
    const { data, error } = await q;
    if (error) throw new Error(`read ${table}: ${error.message}`);
    return data as Row[];
  }

  async function listAll(prefix: string): Promise<string[]> {
    const { data, error } = await admin.storage.from("frames").list(prefix, { limit: 1000 });
    if (error) throw new Error(`list ${prefix}: ${error.message}`);
    const out: string[] = [];
    for (const o of data ?? []) {
      const path = `${prefix}/${o.name}`;
      if (o.id === null) out.push(...(await listAll(path)));
      else out.push(path);
    }
    return out;
  }

  async function seedUser(tag: "a" | "b"): Promise<User> {
    const t = target as Extract<Target, { kind: "run" }>;
    const password = `pw-${crypto.randomUUID()}`;
    const email = `rls-${run}-${tag}@example.test`;
    const { data: u, error: ue } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (ue || !u.user) throw new Error(`create user ${tag}: ${ue?.message}`);
    created.userIds.push(u.user.id);

    const client = createClient(t.url, t.anonKey, opts);
    const { error: se } = await client.auth.signInWithPassword({ email, password });
    if (se) throw new Error(`sign in ${tag}: ${se.message}`);

    const { data: ws, error: be } = await client.rpc("bootstrap_workspace");
    if (be || !Array.isArray(ws) || ws.length !== 1) throw new Error(`bootstrap_workspace ${tag}: ${be?.message}`);
    const ctx: Ctx = { run, tag, uid: u.user.id, ws: ws[0].workspace_id, sid: sessionId(run, tag), agent: "", process: "" };
    created.ws.add(ctx.ws);

    for (const [table, e] of Object.entries(POLICY_MATRIX)) {
      if (!e.row) continue;
      const db = e.seed === "client" ? client : admin;
      const { data, error } = await db.from(table).insert(e.row(ctx)).select().single();
      if (error) throw new Error(`seed ${table} (${e.seed}) for ${tag}: ${error.message}`);
      if (e.provides) ctx[e.provides] = (data as Row).id as string;
    }

    const body = new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });
    const { error: fe } = await client.storage.from("frames").upload(framePath(ctx, "f1.jpg"), body, { contentType: "image/jpeg" });
    if (fe) throw new Error(`seed frame for ${tag}: ${fe.message}`);
    return { client, ctx };
  }

  beforeAll(async () => {
    const t = target as Extract<Target, { kind: "run" }>;
    admin = createClient(t.url, t.serviceKey, opts);
    anon = createClient(t.url, t.anonKey, opts);
    A = await seedUser("a");
    B = await seedUser("b");
    for (const table of [...tablesIn("tenant"), ...tablesIn("no_client")]) {
      snapshot[`a:${table}`] = await rowsOf(admin, table, A.ctx);
      snapshot[`b:${table}`] = await rowsOf(admin, table, B.ctx);
    }
    for (const table of tablesIn("global_read")) snapshot[table] = await rowsOf(admin, table);
  });

  // Runs after failures too. Workspaces first (the cascade removes memberships, sessions and children; deleting a
  // sole owner before the workspace would trip the last-owner guard), then the users.
  afterAll(async () => {
    if (!admin) return;
    const problems: string[] = [];
    if (created.userIds.length) {
      const { data } = await admin.from("workspace_members").select("workspace_id").in("user_id", created.userIds);
      for (const r of data ?? []) created.ws.add(r.workspace_id as string);
    }
    const wsIds = [...created.ws];

    for (const ws of wsIds) {
      const paths = await listAll(ws).catch((e: Error) => (problems.push(e.message), []));
      if (paths.length) {
        const { error } = await admin.storage.from("frames").remove(paths);
        if (error) problems.push(`remove objects under ${ws}: ${error.message}`);
      }
    }
    if (wsIds.length) {
      const { error } = await admin.from("workspaces").delete().in("id", wsIds);
      if (error) problems.push(`delete workspaces: ${error.message}`);
    }
    for (const id of created.userIds) {
      const { error } = await admin.auth.admin.deleteUser(id);
      if (error) problems.push(`delete user ${id}: ${error.message}`);
    }

    for (const table of [...tablesIn("tenant"), ...tablesIn("no_client")]) {
      const s = POLICY_MATRIX[table].scope!;
      const ids = s.from === "ws" ? wsIds : created.sids;
      if (!ids.length) continue;
      const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).in(s.column, ids);
      if (error) problems.push(`verify ${table}: ${error.message}`);
      else if (count !== 0) problems.push(`${table}: ${count} rows left for the run`);
    }
    for (const ws of wsIds) {
      const left = await listAll(ws).catch((e: Error) => [e.message]);
      if (left.length) problems.push(`storage under ${ws}: ${left.join(", ")}`);
    }
    for (const id of created.userIds) {
      const { data } = await admin.auth.admin.getUserById(id);
      if (data?.user) problems.push(`user ${id} still exists`);
    }
    if (problems.length) throw new Error(`teardown left data behind:\n${problems.join("\n")}`);
  });

  it("precondition: every tenant table has seeded rows for A and B", () => {
    for (const table of tablesIn("tenant")) {
      expect(snapshot[`a:${table}`].length, `A ${table}`).toBeGreaterThan(0);
      expect(snapshot[`b:${table}`].length, `B ${table}`).toBeGreaterThan(0);
    }
  });

  for (const table of tablesIn("tenant")) {
    it(`tenant ${table}: A sees, inserts, updates and deletes nothing of B and reads its own rows`, async () => {
      const e = POLICY_MATRIX[table];
      const col = e.scope!.column;

      const cross = await A.client.from(table).select("*").eq(col, scopeValue(table, B.ctx));
      expect(cross.error, `select ${table}`).toBeNull();
      expect(cross.data, `select ${table}`).toHaveLength(0);
      const all = await A.client.from(table).select(col);
      expect(all.error).toBeNull();
      expect((all.data as unknown as Row[]).every((r) => r[col] === scopeValue(table, A.ctx)), `${table} leaks other rows`).toBe(true);

      const ins = await A.client.from(table).insert(e.attack(A.ctx, B.ctx)).select();
      expect(ins.error?.code, `insert ${table}: ${ins.error?.message ?? "allowed"}`).toBe("42501");

      for (const row of snapshot[`b:${table}`]) {
        const match = pick(row, e.key);
        expectDenied(await A.client.from(table).update(e.patch).match(match).select(), `update ${table} ${JSON.stringify(match)}`);
        expectDenied(await A.client.from(table).delete().match(match).select(), `delete ${table} ${JSON.stringify(match)}`);
      }
      expect(await rowsOf(admin, table, B.ctx), `B ${table} changed`).toEqual(snapshot[`b:${table}`]);

      const own = await A.client.from(table).select("*").eq(col, scopeValue(table, A.ctx));
      expect(own.error).toBeNull();
      expect(own.data).toHaveLength(snapshot[`a:${table}`].length);
    });
  }

  for (const table of tablesIn("global_read")) {
    it(`global_read ${table}: A reads, every write is denied`, async () => {
      const e = POLICY_MATRIX[table];
      const sel = await A.client.from(table).select("*");
      expect(sel.error).toBeNull();
      expect((sel.data as Row[]).length).toBeGreaterThan(0);

      const ins = await A.client.from(table).insert(e.attack(A.ctx, B.ctx)).select();
      expect(ins.error?.code, `insert ${table}: ${ins.error?.message ?? "allowed"}`).toBe("42501");
      const match = pick(snapshot[table][0], e.key);
      expectDenied(await A.client.from(table).update(e.patch).match(match).select(), `update ${table}`);
      expectDenied(await A.client.from(table).delete().match(match).select(), `delete ${table}`);
      expect(await rowsOf(admin, table), `${table} changed`).toEqual(snapshot[table]);
    });
  }

  // Empty today (see matrix.ts); a table moved to no_client is covered without changing this file.
  for (const table of tablesIn("no_client")) {
    it(`no_client ${table}: A reads nothing and every write is denied`, async () => {
      const e = POLICY_MATRIX[table];
      expectDenied(await A.client.from(table).select("*"), `select ${table}`);
      const ins = await A.client.from(table).insert(e.attack(A.ctx, B.ctx)).select();
      expect(ins.error?.code, `insert ${table}: ${ins.error?.message ?? "allowed"}`).toBe("42501");
      for (const row of [...snapshot[`a:${table}`], ...snapshot[`b:${table}`]]) {
        const match = pick(row, e.key);
        expectDenied(await A.client.from(table).update(e.patch).match(match).select(), `update ${table}`);
        expectDenied(await A.client.from(table).delete().match(match).select(), `delete ${table}`);
      }
      expect(await rowsOf(admin, table, B.ctx)).toEqual(snapshot[`b:${table}`]);
    });
  }

  for (const [name, r] of Object.entries(RPC_MATRIX)) {
    it(`rpc ${r.signature} as A with B's id: ${r.denied}`, async () => {
      const { data, error } = await A.client.rpc(name, r.args(B.ctx));
      if (r.denied === "error") {
        expect(error?.code, `${name}: ${error?.message ?? "no error"}`).toBe("42501");
        return;
      }
      expect(error, `${name}: ${error?.message}`).toBeNull();
      if (r.denied === "false") expect(data).toBe(false);
      if (r.denied === "null") expect(data).toBeNull();
      if (r.denied === "empty") expect(rowsLen(data)).toBe(0);
    });
  }

  it("B rows are byte-identical after every attack and RPC", async () => {
    for (const table of tablesIn("tenant")) {
      expect(await rowsOf(admin, table, B.ctx), `B ${table}`).toEqual(snapshot[`b:${table}`]);
    }
  });

  it("anon reads nothing from any table", async () => {
    for (const table of Object.keys(POLICY_MATRIX)) {
      const res = await anon.from(table).select("*").limit(1);
      if (res.error) expect(res.error.code, `anon ${table}: ${res.error.message}`).toBe("42501");
      else expect(res.data, `anon ${table}`).toHaveLength(0);
    }
  });

  describe("storage frames bucket", () => {
    const bucket = () => A.client.storage.from("frames");
    const body = () => new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" });

    it("A cannot upload, download, list or remove under B's prefix", async () => {
      const up = await bucket().upload(framePath(B.ctx, "attack.jpg"), body(), { contentType: "image/jpeg" });
      expect(up.error, "upload").not.toBeNull();
      const down = await bucket().download(framePath(B.ctx, "f1.jpg"));
      expect(down.error, "download").not.toBeNull();
      for (const prefix of [B.ctx.ws, `${B.ctx.ws}/${B.ctx.sid}`]) {
        const ls = await bucket().list(prefix);
        if (!ls.error) expect(ls.data, `list ${prefix}`).toHaveLength(0);
      }
      const rm = await bucket().remove([framePath(B.ctx, "f1.jpg")]);
      if (!rm.error) expect(rm.data, "remove").toHaveLength(0);

      expect(await listAll(B.ctx.ws)).toEqual([framePath(B.ctx, "f1.jpg")]);
    });

    it("A uploads, downloads, lists and removes under its own prefix", async () => {
      const own = framePath(A.ctx, "own.jpg");
      const up = await bucket().upload(own, body(), { contentType: "image/jpeg" });
      expect(up.error, `upload: ${up.error?.message}`).toBeNull();
      const down = await bucket().download(framePath(A.ctx, "f1.jpg"));
      expect(down.error, `download: ${down.error?.message}`).toBeNull();
      const ls = await bucket().list(`${A.ctx.ws}/${A.ctx.sid}`);
      expect(ls.error).toBeNull();
      expect((ls.data ?? []).map((o) => o.name).sort()).toEqual(["f1.jpg", "own.jpg"]);
      const rm = await bucket().remove([own]);
      expect(rm.error, `remove: ${rm.error?.message}`).toBeNull();
      expect(rm.data).toHaveLength(1);
      expect(await listAll(A.ctx.ws)).toEqual([framePath(A.ctx, "f1.jpg")]);
    });
  });
});
