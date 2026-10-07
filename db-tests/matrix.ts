// RLS policy matrix: one entry per public table created in supabase/migrations/*.sql, plus the storage buckets and
// the RPCs that take a workspace or session id. db-tests/tables.test.ts fails when a migration creates a table that
// has no entry here; db-tests/rls.test.ts seeds and attacks every entry. See docs/checks/db-tests.md.

// tenant: rows belong to one workspace; members read, other users see and change nothing.
// global_read: any signed-in user reads, nobody writes from a client.
// no_client: no client reads or writes at all (none today; the suite handles the category when one is added).
export type Category = "tenant" | "global_read" | "no_client";

// bootstrap: rows come from bootstrap_workspace() under the owner's session.
// client: inserted by the owner through PostgREST under their own session (an insert policy exists).
// service: inserted with the service role because no client insert policy exists.
// migration: seeded by the migration itself (price tables).
export type SeedRoute = "bootstrap" | "client" | "service" | "migration";

// What a seeded tenant knows about itself. Filled while seeding, in matrix order.
export type Ctx = {
  run: string;
  tag: "a" | "b";
  uid: string;
  ws: string;
  sid: string;
  agent: string;
  process: string;
};

type Row = Record<string, unknown>;

export type TableEntry = {
  category: Category;
  seed: SeedRoute;
  // Primary key columns: B's rows are attacked one by one through these.
  key: string[];
  // Which rows belong to a tenant: column equals ctx.ws or ctx.sid. Unused for global_read.
  scope?: { column: string; from: "ws" | "sid" };
  // The row seeded for a tenant (client and service routes).
  row?: (c: Ctx) => Row;
  // After a seed insert, copy the returned id into the context.
  provides?: "agent" | "process";
  // An insert by A that targets B's workspace or session.
  attack: (a: Ctx, b: Ctx) => Row;
  // An update by A applied to each of B's rows (or to the global rows).
  patch: Row;
};

export const DAY = "2026-10-07";
export const T0 = "2026-10-07T08:00:00.000Z";
export const AVATAR = { shape: "blob", face: "smile", color: "#1E66F5", accent: "#FFD166" };
export const WORKMAP = { task: "t", expert: "e", confirmed_by_expert: false, steps: [], open_questions: [] };

export const sessionId = (run: string, tag: string) => `rls_${run}_${tag}`;
export const framePath = (c: Pick<Ctx, "ws" | "sid">, name: string) => `${c.ws}/${c.sid}/${name}`;
const uuid = () => crypto.randomUUID();

// Insertion order is the seed order: later rows reference earlier ones.
export const POLICY_MATRIX: Record<string, TableEntry> = {
  workspaces: {
    category: "tenant",
    seed: "bootstrap",
    key: ["id"],
    scope: { column: "id", from: "ws" },
    attack: (a) => ({ name: "rls attack", created_by: a.uid }),
    patch: { name: "rls attack" },
  },
  workspace_members: {
    category: "tenant",
    seed: "bootstrap",
    key: ["workspace_id", "user_id"],
    scope: { column: "workspace_id", from: "ws" },
    attack: (a, b) => ({ workspace_id: b.ws, user_id: a.uid, role: "owner" }),
    patch: { role: "learner" },
  },
  workspace_invites: {
    category: "tenant",
    seed: "client",
    key: ["id"],
    scope: { column: "workspace_id", from: "ws" },
    row: (c) => ({ workspace_id: c.ws, email: `rls-invitee-${c.run}-${c.tag}@example.test`, role: "learner", invited_by: c.uid }),
    attack: (a, b) => ({ workspace_id: b.ws, email: `rls-attack-${a.run}@example.test`, role: "expert", invited_by: a.uid }),
    patch: { role: "expert" },
  },
  agents: {
    category: "tenant",
    seed: "client",
    key: ["id"],
    scope: { column: "workspace_id", from: "ws" },
    row: (c) => ({ workspace_id: c.ws, name: `Agent ${c.tag}`, role: "Clerk", avatar: AVATAR, created_by: c.uid }),
    provides: "agent",
    attack: (a, b) => ({ workspace_id: b.ws, name: "Attack", role: "Clerk", avatar: AVATAR, created_by: a.uid }),
    patch: { name: "rls attack" },
  },
  sessions: {
    category: "tenant",
    seed: "client",
    key: ["id"],
    scope: { column: "workspace_id", from: "ws" },
    row: (c) => ({ id: c.sid, workspace_id: c.ws, created_by: c.uid, kind: "capture", started_at: T0, agent_id: c.agent }),
    attack: (a, b) => ({ id: `${a.sid}_attack`, workspace_id: b.ws, created_by: a.uid, kind: "teach", started_at: T0 }),
    patch: { expert: "rls attack" },
  },
  session_events: {
    category: "tenant",
    seed: "client",
    key: ["id"],
    scope: { column: "session_id", from: "sid" },
    row: (c) => ({ session_id: c.sid, t: 1, payload: { seed: c.tag } }),
    attack: (_a, b) => ({ session_id: b.sid, t: 2, payload: { attack: true } }),
    patch: { payload: { attack: true } },
  },
  session_transcript: {
    category: "tenant",
    seed: "client",
    key: ["id"],
    scope: { column: "session_id", from: "sid" },
    row: (c) => ({ session_id: c.sid, t: 1, payload: { seed: c.tag } }),
    attack: (_a, b) => ({ session_id: b.sid, t: 2, payload: { attack: true } }),
    patch: { payload: { attack: true } },
  },
  session_qa: {
    category: "tenant",
    seed: "client",
    key: ["session_id", "qa_id"],
    scope: { column: "session_id", from: "sid" },
    row: (c) => ({ session_id: c.sid, qa_id: "q1", t: 1, payload: { seed: c.tag } }),
    attack: (_a, b) => ({ session_id: b.sid, qa_id: "attack", payload: { attack: true } }),
    patch: { payload: { attack: true } },
  },
  session_frames: {
    category: "tenant",
    seed: "client",
    key: ["session_id", "name"],
    scope: { column: "session_id", from: "sid" },
    row: (c) => ({ session_id: c.sid, name: "f1.jpg", t: 1, storage_path: framePath(c, "f1.jpg") }),
    attack: (_a, b) => ({ session_id: b.sid, name: "attack.jpg", storage_path: framePath(b, "attack.jpg") }),
    patch: { t: 99 },
  },
  agent_deletion_requests: {
    category: "tenant",
    seed: "client",
    key: ["id"],
    scope: { column: "workspace_id", from: "ws" },
    row: (c) => ({ workspace_id: c.ws, agent_id: c.agent, agent_name: `Agent ${c.tag}`, requested_by: c.uid }),
    attack: (a, b) => ({ workspace_id: b.ws, agent_id: null, agent_name: "Attack", requested_by: a.uid }),
    patch: { status: "declined", decided_at: T0 },
  },
  usage_counters: {
    category: "tenant",
    seed: "service",
    key: ["workspace_id", "day", "kind"],
    scope: { column: "workspace_id", from: "ws" },
    row: (c) => ({ workspace_id: c.ws, day: DAY, kind: "vision", count: 1 }),
    attack: (_a, b) => ({ workspace_id: b.ws, day: DAY, kind: "decide", count: 0 }),
    patch: { count: 999 },
  },
  agent_reports: {
    category: "tenant",
    seed: "service",
    key: ["id"],
    scope: { column: "workspace_id", from: "ws" },
    row: (c) => ({ workspace_id: c.ws, agent_id: uuid(), agent_name: `Gone ${c.tag}`, deleted_by: c.uid }),
    attack: (a, b) => ({ workspace_id: b.ws, agent_id: uuid(), agent_name: "Attack", deleted_by: a.uid }),
    patch: { agent_name: "rls attack" },
  },
  processes: {
    category: "tenant",
    seed: "service",
    key: ["id"],
    scope: { column: "workspace_id", from: "ws" },
    row: (c) => ({ workspace_id: c.ws, agent_id: c.agent, title: `Process ${c.tag}`, workmap: WORKMAP, created_by: c.uid }),
    provides: "process",
    attack: (a, b) => ({ workspace_id: b.ws, agent_id: b.agent, title: "Attack", workmap: WORKMAP, created_by: a.uid }),
    patch: { title: "rls attack" },
  },
  process_versions: {
    category: "tenant",
    seed: "service",
    key: ["id"],
    scope: { column: "workspace_id", from: "ws" },
    row: (c) => ({ workspace_id: c.ws, process_id: c.process, version: 1, workmap: WORKMAP, change_kind: "trained", changed_by: c.uid }),
    attack: (a, b) => ({ workspace_id: b.ws, process_id: b.process, version: 2, workmap: WORKMAP, change_kind: "edited", changed_by: a.uid }),
    patch: { change_kind: "edited" },
  },
  processes_tombstones: {
    category: "tenant",
    seed: "service",
    key: ["source_session_id"],
    scope: { column: "workspace_id", from: "ws" },
    row: (c) => ({ source_session_id: c.sid, workspace_id: c.ws }),
    attack: (a, b) => ({ source_session_id: a.sid, workspace_id: b.ws }),
    patch: { deleted_at: T0 },
  },
  usage_events: {
    category: "tenant",
    seed: "service",
    key: ["id"],
    scope: { column: "workspace_id", from: "ws" },
    row: (c) => ({ workspace_id: c.ws, user_id: c.uid, session_id: c.sid, kind: "frame", bytes: 1 }),
    attack: (a, b) => ({ workspace_id: b.ws, user_id: a.uid, kind: "frame", bytes: 1 }),
    patch: { bytes: 999 },
  },
  model_prices: {
    category: "global_read",
    seed: "migration",
    key: ["model", "valid_from"],
    attack: () => ({ model: "rls-attack", valid_from: DAY, chf_per_m_input: 0, chf_per_m_output: 0, chf_per_m_cache_read: 0 }),
    patch: { chf_per_m_input: 0 },
  },
  voice_prices: {
    category: "global_read",
    seed: "migration",
    key: ["valid_from"],
    attack: () => ({ valid_from: "2099-01-01", chf_per_minute: 0 }),
    patch: { chf_per_minute: 0 },
  },
};

// Storage buckets: the frames bucket is private, paths are workspace_id/session_id/name.
export const STORAGE_MATRIX = {
  frames: { category: "tenant" as Category, seed: "client" as SeedRoute, seedObject: "f1.jpg" },
};

// How an RPC answers A when called with B's workspace or session id.
// false and null: the plain value; empty: zero rows; error: raises 42501.
export type RpcDenial = "false" | "null" | "empty" | "error";

export type RpcEntry = {
  signature: string;
  args: (b: Ctx) => Record<string, unknown>;
  denied: RpcDenial;
};

export const RPC_MATRIX: Record<string, RpcEntry> = {
  is_workspace_member: { signature: "is_workspace_member(uuid)", args: (b) => ({ ws: b.ws }), denied: "false" },
  is_workspace_member_text: { signature: "is_workspace_member_text(text)", args: (b) => ({ ws: b.ws }), denied: "false" },
  workspace_role: { signature: "workspace_role(uuid)", args: (b) => ({ ws: b.ws }), denied: "null" },
  can_read_session: { signature: "can_read_session(text)", args: (b) => ({ sid: b.sid }), denied: "false" },
  can_write_session: { signature: "can_write_session(text)", args: (b) => ({ sid: b.sid }), denied: "false" },
  session_frame_prefix: { signature: "session_frame_prefix(text)", args: (b) => ({ sid: b.sid }), denied: "null" },
  consume_usage: { signature: "consume_usage(uuid,text,int)", args: (b) => ({ ws: b.ws, k: "vision", cap: 100 }), denied: "error" },
  // Security invoker: the agents_update policy hides B's agent, the update matches nothing.
  agent_settings_patch: {
    signature: "agent_settings_patch(uuid,uuid,jsonb)",
    args: (b) => ({ p_workspace: b.ws, p_agent: b.agent, p_patch: { guardrails_first: true } }),
    denied: "null",
  },
  create_process: {
    signature: "create_process(uuid,uuid,text,jsonb,text,boolean)",
    args: (b) => ({ p_workspace_id: b.ws, p_agent_id: b.agent, p_title: "Attack", p_workmap: WORKMAP, p_source_session: b.sid, p_backfill: false }),
    denied: "error",
  },
};

// Take no id; used only to seed (bootstrap_workspace) or not at all here (create_workspace).
export const SEED_ONLY_RPCS = ["bootstrap_workspace()", "create_workspace(text,text)"];

// Table names created by a migration: `create table [if not exists] public.<name>`.
export function tablesInSql(sql: string): string[] {
  const re = /create\s+table\s+(?:if\s+not\s+exists\s+)?public\.("?)([a-z_][a-z0-9_]*)\1/gi;
  return [...sql.matchAll(re)].map((m) => m[2].toLowerCase());
}
