// In-memory fake of the supabase-js surface the supabase store uses, and nothing else. Test only.
// Any other method or option throws an Error naming it, so drift between backend and fake fails the tests.
// Modelled: filters and ordering, primary keys (23505), the max-rows cap, RLS as a set of visible workspace ids
// (42501 on writes to an invisible session), the sessions insert policy (created_by = auth.uid()), the
// session_frames.storage_path prefix check, timestamptz output strings and the storage not-found error shape.
// Not modelled: workspace roles (owner/expert/learner), column projection on count queries.

type Row = Record<string, unknown>;
export type FakeError = { message: string; code?: string; details?: string | null; hint?: string | null };
export type FakeStorageError = { name?: string; message: string; status?: number; statusCode?: string };
type Filter = { col: string; op: "eq" | "gte" | "lte" | "in"; val: unknown };
type Order = { col: string; ascending: boolean; nullsFirst: boolean };

const PKS: Record<string, string[]> = {
  sessions: ["id"],
  session_events: ["id"],
  session_transcript: ["id"],
  session_qa: ["session_id", "qa_id"],
  session_frames: ["session_id", "name"],
};
const SERIAL = new Set(["session_events", "session_transcript"]);
// Nullable columns come back as null, like Postgres, when an insert leaves them out.
const DEFAULTS: Record<string, Row> = {
  sessions: { created_by: null, expert: null, ended_at: null, workmap: null, off_record_ranges: [] },
  session_qa: { t: null },
  session_frames: { t: null },
};
const TIMESTAMPTZ = new Set(["started_at", "ended_at", "created_at"]);

function unsupported(what: string): never {
  throw new Error(`fakeSupabase: unsupported ${what}`);
}

function checkOpts(where: string, opts: unknown, allowed: string[]): void {
  if (opts === undefined) return;
  for (const k of Object.keys(opts as object)) if (!allowed.includes(k)) unsupported(`option ${where}.${k}`);
}

/** Throws on any property the target does not define (symbols and then pass through). */
function strict<T extends object>(target: T, label: string): T {
  return new Proxy(target, {
    get(t, prop, recv) {
      if (typeof prop === "symbol" || prop in t) return Reflect.get(t, prop, recv);
      return unsupported(`method ${label}.${prop}`);
    },
  });
}

/** Postgres timestamptz text output, e.g. 2026-10-03T19:35:00.123+00:00. */
function pgTs(v: unknown): unknown {
  if (typeof v !== "string") return v;
  return new Date(v).toISOString().replace("Z", "+00:00");
}

function cmp(a: unknown, b: unknown): number {
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

const rlsError = (table: string): FakeError => ({
  message: `new row violates row-level security policy for table "${table}"`,
  code: "42501",
});

export class FakeSupabase {
  tables: Record<string, Row[]> = Object.fromEntries(Object.keys(PKS).map((t) => [t, []]));
  objects = new Map<string, Uint8Array>();
  visibleWorkspaces = new Set<string>();
  maxRows: number;
  uid: string;
  private serial = 0;
  private failures = new Map<string, FakeError | FakeStorageError>();
  readonly client: unknown;

  constructor(opts: { uid: string; maxRows?: number; workspaces?: string[] }) {
    this.uid = opts.uid;
    this.maxRows = opts.maxRows ?? 1000;
    for (const w of opts.workspaces ?? []) this.visibleWorkspaces.add(w);
    const fake = this;
    const storage = strict(
      {
        from(bucket: string) {
          if (bucket !== "frames") unsupported(`bucket ${bucket}`);
          return fake.bucket();
        },
      },
      "storage",
    );
    this.client = strict({ from: (table: string) => fake.query(table), storage }, "client");
  }

  /** Makes the next call on a table (or on storage, target 'storage') return this error. */
  failNext(target: string, error: FakeError | FakeStorageError): void {
    this.failures.set(target, error);
  }

  takeFailure(target: string): FakeError | FakeStorageError | undefined {
    const e = this.failures.get(target);
    if (e) this.failures.delete(target);
    return e;
  }

  sessionVisible(sessionId: unknown): boolean {
    const s = this.tables.sessions.find((r) => r.id === sessionId);
    return !!s && this.visibleWorkspaces.has(s.workspace_id as string);
  }

  rowVisible(table: string, row: Row): boolean {
    if (table === "sessions") return this.visibleWorkspaces.has(row.workspace_id as string);
    return this.sessionVisible(row.session_id);
  }

  /** Returns an RLS error for a row the current user may not write, else null. */
  writeDenied(table: string, row: Row): FakeError | null {
    if (table === "sessions") {
      if (row.created_by !== this.uid || !this.visibleWorkspaces.has(row.workspace_id as string)) return rlsError(table);
      return null;
    }
    if (!this.sessionVisible(row.session_id)) return rlsError(table);
    if (table === "session_frames") {
      const s = this.tables.sessions.find((r) => r.id === row.session_id)!;
      if (row.storage_path !== `${s.workspace_id}/${s.id}/${row.name}`) return rlsError(table);
    }
    return null;
  }

  normalise(table: string, row: Row, insert = true): Row {
    const out = structuredClone(row);
    for (const k of Object.keys(out)) if (TIMESTAMPTZ.has(k)) out[k] = pgTs(out[k]);
    if (!insert) return out;
    for (const [k, v] of Object.entries(DEFAULTS[table] ?? {})) if (out[k] === undefined) out[k] = structuredClone(v);
    if (table === "sessions" && out.created_at === undefined) out.created_at = pgTs(new Date().toISOString());
    if (SERIAL.has(table) && out.id === undefined) out.id = ++this.serial;
    return out;
  }

  private query(table: string) {
    if (!(table in PKS)) unsupported(`table ${table}`);
    return strict(new FakeQuery(this, table), `from(${table})`);
  }

  private bucket() {
    const fake = this;
    const notFound: FakeStorageError = { name: "StorageApiError", message: "Object not found", status: 400, statusCode: "404" };
    const denied: FakeStorageError = {
      name: "StorageApiError",
      message: "new row violates row-level security policy",
      status: 403,
      statusCode: "403",
    };
    const writable = (p: string) => {
      const [ws, sid] = p.split("/");
      const s = fake.tables.sessions.find((r) => r.id === sid);
      return !!s && s.workspace_id === ws && fake.visibleWorkspaces.has(ws);
    };
    return strict(
      {
        async upload(p: string, body: Buffer | Uint8Array, opts?: { upsert?: boolean; contentType?: string }) {
          checkOpts("upload", opts, ["upsert", "contentType"]);
          const failure = fake.takeFailure("storage");
          if (failure) return { data: null, error: failure };
          if (!writable(p)) return { data: null, error: denied };
          if (fake.objects.has(p) && !opts?.upsert)
            return { data: null, error: { name: "StorageApiError", message: "The resource already exists", status: 400, statusCode: "409" } };
          fake.objects.set(p, new Uint8Array(body));
          return { data: { path: p }, error: null };
        },
        async download(p: string, opts?: unknown) {
          checkOpts("download", opts, []);
          const failure = fake.takeFailure("storage");
          if (failure) return { data: null, error: failure };
          const ws = p.split("/")[0];
          const bytes = fake.objects.get(p);
          if (!bytes || !fake.visibleWorkspaces.has(ws)) return { data: null, error: notFound };
          return { data: new Blob([new Uint8Array(bytes)]), error: null };
        },
        async remove(paths: string[]) {
          const failure = fake.takeFailure("storage");
          if (failure) return { data: null, error: failure };
          const removed = [];
          for (const p of paths) {
            if (fake.objects.has(p) && writable(p)) {
              fake.objects.delete(p);
              removed.push({ name: p });
            }
          }
          return { data: removed, error: null };
        },
      },
      "storage.from(frames)",
    );
  }
}

type Result = { data: unknown; error: FakeError | null; count: number | null; status: number };

class FakeQuery {
  private op: "select" | "insert" | "upsert" | "update" | "delete" | null = null;
  private filters: Filter[] = [];
  private orders: Order[] = [];
  private rangeFrom: number | null = null;
  private rangeTo: number | null = null;
  private returning = false;
  private columns: string[] | null = null;
  private countHead = false;
  private mode: "single" | "maybeSingle" | null = null;
  private payload: Row[] = [];
  private values: Row = {};
  private onConflict: string[] = [];

  constructor(
    private fake: FakeSupabase,
    private table: string,
  ) {}

  select(cols = "*", opts?: { count?: string; head?: boolean }) {
    checkOpts("select", opts, ["count", "head"]);
    if (opts?.count !== undefined && opts.count !== "exact") unsupported(`option select.count=${opts.count}`);
    if (opts && (opts.count === undefined) !== (opts.head === undefined)) unsupported("select count without head");
    this.columns = cols === "*" ? null : cols.split(",").map((c) => c.trim());
    if (this.op === null) {
      this.op = "select";
      this.countHead = opts?.head === true;
    } else {
      if (opts) unsupported("options on returning select");
      this.returning = true;
    }
    return this;
  }

  insert(rows: Row | Row[], opts?: unknown) {
    checkOpts("insert", opts, []);
    this.op = "insert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    return this;
  }

  upsert(rows: Row | Row[], opts?: { onConflict?: string }) {
    checkOpts("upsert", opts, ["onConflict"]);
    this.op = "upsert";
    this.payload = Array.isArray(rows) ? rows : [rows];
    this.onConflict = (opts?.onConflict ?? PKS[this.table].join(",")).split(",").map((c) => c.trim());
    return this;
  }

  update(values: Row, opts?: unknown) {
    checkOpts("update", opts, []);
    this.op = "update";
    this.values = values;
    return this;
  }

  delete(opts?: unknown) {
    checkOpts("delete", opts, []);
    this.op = "delete";
    return this;
  }

  eq(col: string, val: unknown) {
    this.filters.push({ col, op: "eq", val });
    return this;
  }

  gte(col: string, val: unknown) {
    this.filters.push({ col, op: "gte", val });
    return this;
  }

  lte(col: string, val: unknown) {
    this.filters.push({ col, op: "lte", val });
    return this;
  }

  in(col: string, vals: unknown[]) {
    this.filters.push({ col, op: "in", val: vals });
    return this;
  }

  order(col: string, opts?: { ascending?: boolean; nullsFirst?: boolean }) {
    checkOpts("order", opts, ["ascending", "nullsFirst"]);
    const ascending = opts?.ascending ?? true;
    // Postgres default: nulls last ascending, nulls first descending.
    this.orders.push({ col, ascending, nullsFirst: opts?.nullsFirst ?? !ascending });
    return this;
  }

  range(from: number, to: number) {
    this.rangeFrom = from;
    this.rangeTo = to;
    return this;
  }

  single() {
    this.mode = "single";
    return this;
  }

  maybeSingle() {
    this.mode = "maybeSingle";
    return this;
  }

  then<A = Result, B = never>(
    ok?: ((v: Result) => A | PromiseLike<A>) | null,
    err?: ((e: unknown) => B | PromiseLike<B>) | null,
  ): Promise<A | B> {
    return Promise.resolve()
      .then(() => this.run())
      .then(ok, err);
  }

  private matches(row: Row): boolean {
    return this.filters.every((f) => {
      const v = row[f.col];
      if (f.op === "eq") return v === f.val;
      if (f.op === "in") return (f.val as unknown[]).includes(v);
      if (v === null || v === undefined) return false;
      return f.op === "gte" ? cmp(v, f.val) >= 0 : cmp(v, f.val) <= 0;
    });
  }

  private project(row: Row): Row {
    const out = structuredClone(row);
    if (!this.columns) return out;
    return Object.fromEntries(this.columns.map((c) => [c, out[c]]));
  }

  private finish(rows: Row[]): Result {
    let data: Row[] = rows.map((r) => this.project(r));
    if (this.mode) {
      if (data.length > 1 || (data.length === 0 && this.mode === "single")) {
        return {
          data: null,
          error: { message: "JSON object requested, multiple (or no) rows returned", code: "PGRST116" },
          count: null,
          status: 406,
        };
      }
      return { data: data[0] ?? null, error: null, count: null, status: 200 };
    }
    if (this.op !== "select" && !this.returning) return { data: null, error: null, count: null, status: 201 };
    data = data.slice(0, this.fake.maxRows);
    return { data, error: null, count: null, status: 200 };
  }

  private run(): Result {
    const failure = this.fake.takeFailure(this.table);
    if (failure) return { data: null, error: failure as FakeError, count: null, status: 400 };
    const all = this.fake.tables[this.table];
    const err = (error: FakeError, status = 400): Result => ({ data: null, error, count: null, status });

    if (this.op === "select") {
      let rows = all.filter((r) => this.fake.rowVisible(this.table, r) && this.matches(r));
      if (this.countHead) return { data: null, error: null, count: rows.length, status: 200 };
      rows = [...rows].sort((a, b) => {
        for (const o of this.orders) {
          const av = a[o.col] ?? null;
          const bv = b[o.col] ?? null;
          if (av === null && bv === null) continue;
          if (av === null) return o.nullsFirst ? -1 : 1;
          if (bv === null) return o.nullsFirst ? 1 : -1;
          const c = cmp(av, bv);
          if (c !== 0) return o.ascending ? c : -c;
        }
        return 0;
      });
      if (this.rangeFrom !== null) rows = rows.slice(this.rangeFrom, (this.rangeTo as number) + 1);
      return this.finish(rows);
    }

    if (this.op === "insert" || this.op === "upsert") {
      const pk = PKS[this.table];
      const key = (r: Row, cols: string[]) => JSON.stringify(cols.map((c) => r[c]));
      const next = [...all];
      const out: Row[] = [];
      for (const raw of this.payload) {
        const row = this.fake.normalise(this.table, raw);
        const denied = this.fake.writeDenied(this.table, row);
        if (denied) return err(denied, 403);
        const conflictCols = this.op === "upsert" ? this.onConflict : pk;
        const i = next.findIndex((r) => key(r, conflictCols) === key(row, conflictCols));
        if (i >= 0 && this.op === "insert") {
          return err({ message: `duplicate key value violates unique constraint "${this.table}_pkey"`, code: "23505" }, 409);
        }
        if (i >= 0) next[i] = { ...next[i], ...row };
        else next.push(row);
        out.push(i >= 0 ? next[i] : row);
      }
      this.fake.tables[this.table] = next;
      return this.finish(out);
    }

    if (this.op === "update") {
      const out: Row[] = [];
      const next = all.map((r) => {
        if (!this.fake.rowVisible(this.table, r) || !this.matches(r)) return r;
        const updated = { ...r, ...this.fake.normalise(this.table, this.values, false) };
        out.push(updated);
        return updated;
      });
      this.fake.tables[this.table] = next;
      return this.finish(out);
    }

    if (this.op === "delete") {
      const out = all.filter((r) => this.fake.rowVisible(this.table, r) && this.matches(r));
      this.fake.tables[this.table] = all.filter((r) => !out.includes(r));
      return this.finish(out);
    }

    return unsupported("query without an operation");
  }
}
