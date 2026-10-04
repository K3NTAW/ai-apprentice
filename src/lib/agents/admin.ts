// Agent settings, deletion requests, delete with data and frame retention. Server only.
// File backend: data/agent_settings.json, data/agent_deletion_requests.json, data/agent_reports.json (legacy, no
// longer written: a delete removes the agent's report). Supabase backend: agents.settings,
// public.agent_deletion_requests, public.agent_reports
// (supabase/migrations/20261004010000_agent_settings.sql).
//
// Until that migration is applied, settings reads answer the defaults with available: false and every write throws
// SettingsUnavailableError. Only the undefined column / function / table errors count as "not applied".
//
// Delete contract (owner Delete and owner Approve run the same deleteAgentWithData). Everything of the agent goes:
//  1. the frame objects of every session of the agent (capture, debrief, teach), listed by session prefix and
//     removed in batches. A Storage error is logged and does not stop the delete: rows are the source of truth,
//     a later retention run can sweep leftover objects;
//  2. every session of the agent with its events, Q&A, transcript, frame rows, Work Map and teach progress;
//  3. the agent row with its settings, its processes and their versions (supabase: on delete cascade, migration
//     20261004060000_agent_delete_cascade). Deletion requests keep agent_name, their agent_id goes null.
// A row step that fails throws DeleteAgentError and leaves later steps undone; a retry repeats every step safely.
// An agent that is already gone answers { deleted: false } (Approve then just records the decision).
import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RequestContext } from "@/lib/auth/context";
import { dataDir, fileStore, framePath } from "@/lib/store";
import { appMode } from "@/lib/supabase/env";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { AgentSettingsPatch, resolveSettings, type AgentSettings } from "./settings";

export class SettingsUnavailableError extends Error {
  readonly code = "settings_unavailable";
  constructor() {
    super("Settings are not available yet: the database migration 20261004010000_agent_settings is not applied.");
    this.name = "SettingsUnavailableError";
  }
}

export class DeleteAgentError extends Error {
  constructor(readonly step: "sessions" | "agent", cause: unknown) {
    super(`delete agent failed at ${step}: ${cause instanceof Error ? cause.message : JSON.stringify(cause)}`);
    this.name = "DeleteAgentError";
  }
}

export class RequestNotFoundError extends Error {
  constructor(id: string) {
    super(`deletion request not found: ${id}`);
    this.name = "RequestNotFoundError";
  }
}

/** 42703 undefined_column, 42883 undefined_function, 42P01 undefined_table, PostgREST schema cache misses. */
export function isMigrationMissing(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const e = error as { code?: unknown; message?: unknown };
  const msg = typeof e.message === "string" ? e.message : "";
  const ours = /settings|agent_settings_patch|agent_deletion_requests|agent_reports/.test(msg);
  if (e.code === "42703" || e.code === "42883" || e.code === "42P01") return ours;
  if (e.code === "PGRST204" || e.code === "PGRST202" || e.code === "PGRST205") return ours;
  return false;
}

export type DeletionStatus = "pending" | "approved" | "declined";
export type DeletionRequest = {
  id: string;
  workspace_id: string;
  agent_id: string | null;
  agent_name: string;
  requested_by: string | null;
  created_at: string;
  status: DeletionStatus;
  decided_by: string | null;
  decided_at: string | null;
};
export type DeleteResult = { deleted: boolean; frames: number; sessions: number };
export type TeachRecord = { session_id: string; created_by: string | null; started_at: string; ended_at: string | null };
/** Written by the earlier delete contract (teach sessions kept); a delete now removes the agent's row. */
export type AgentReport = {
  workspace_id: string;
  agent_id: string;
  agent_name: string;
  deleted_by: string | null;
  deleted_at: string;
  teach: TeachRecord[];
};

export interface AgentAdmin {
  getSettings(agentId: string): Promise<{ settings: AgentSettings; available: boolean }>;
  /** Merge patch; returns the full settings. Throws SettingsUnavailableError before the migration. */
  patchSettings(agentId: string, patch: AgentSettingsPatch): Promise<AgentSettings>;
  listRequests(): Promise<DeletionRequest[]>;
  /** Idempotent: a second request for the same agent answers the pending one. */
  requestDeletion(agentId: string, agentName: string): Promise<DeletionRequest>;
  getRequest(id: string): Promise<DeletionRequest | null>;
  /** pending -> approved or declined. Throws RequestNotFoundError when missing or already decided. */
  decide(id: string, status: "approved" | "declined"): Promise<DeletionRequest>;
  deleteAgentWithData(agentId: string): Promise<DeleteResult>;
  /** The user who created the agent; null when unknown (file backend, deleted user) or missing. */
  creatorOf(agentId: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// Frame storage port: shared by delete and retention so both are tested with a fake.
// ---------------------------------------------------------------------------

export type FrameRef = { session_id: string; name: string; path: string };
export type SessionRef = { id: string; kind: "capture" | "teach"; created_by: string | null; started_at: string; ended_at: string | null };

export type DataPort = {
  agentName(agentId: string): Promise<string | null>;
  sessionsOf(agentId: string): Promise<SessionRef[]>;
  /** Every stored frame object of these sessions (listed by session prefix, not by rows). */
  frameObjectsOf(sessionIds: string[]): Promise<string[]>;
  removeObjects(paths: string[]): Promise<void>;
  /** The sessions with all their child rows. */
  deleteSessions(ids: string[]): Promise<void>;
  /** The agent row with its settings, processes and versions. */
  deleteAgent(agentId: string): Promise<void>;
};

export const STORAGE_BATCH = 100;
const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

async function step<T>(name: DeleteAgentError["step"], fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    throw new DeleteAgentError(name, err);
  }
}

export async function deleteAgentData(
  port: DataPort,
  input: { workspaceId: string; agentId: string; userId: string | null },
): Promise<DeleteResult> {
  const name = await port.agentName(input.agentId);
  if (name === null) return { deleted: false, frames: 0, sessions: 0 };
  const ids = (await port.sessionsOf(input.agentId)).map((s) => s.id);
  const paths = await port.frameObjectsOf(ids).catch((err: unknown) => {
    console.error(`delete agent ${input.agentId}: listing frames failed, continuing`, err);
    return [] as string[];
  });
  for (const batch of chunks(paths, STORAGE_BATCH)) {
    await port.removeObjects(batch).catch((err: unknown) => {
      console.error(`delete agent ${input.agentId}: removing ${batch.length} frames failed, continuing`, err);
    });
  }
  await step("sessions", () => port.deleteSessions(ids));
  await step("agent", () => port.deleteAgent(input.agentId));
  return { deleted: true, frames: paths.length, sessions: ids.length };
}

// ---------------------------------------------------------------------------
// Retention: frames older than the agent's retention_days. Idempotent and batch-limited:
// Storage objects first, then rows, so an interrupted run is picked up by the next one.
// ---------------------------------------------------------------------------

export type RetentionPort = {
  agents(): Promise<{ id: string; settings: unknown }[]>;
  /** Frames of the agent's sessions whose time (session start + t) is before cutoffMs, at most limit. */
  oldFrames(agentId: string, cutoffMs: number, limit: number): Promise<FrameRef[]>;
  removeObjects(paths: string[]): Promise<void>;
  deleteFrameRows(frames: FrameRef[]): Promise<void>;
};
export type RetentionResult = { agents: number; deleted: number; more: boolean };
export const RETENTION_BATCH = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

export async function runRetention(port: RetentionPort, now: number, limit = RETENTION_BATCH): Promise<RetentionResult> {
  const agents = await port.agents();
  let left = limit;
  let deleted = 0;
  for (const a of agents) {
    if (left <= 0) break;
    const cutoff = now - resolveSettings(a.settings).retention_days * DAY_MS;
    const frames = await port.oldFrames(a.id, cutoff, left);
    if (frames.length === 0) continue;
    for (const batch of chunks(frames.map((f) => f.path), STORAGE_BATCH)) await port.removeObjects(batch);
    await port.deleteFrameRows(frames);
    deleted += frames.length;
    left -= frames.length;
  }
  return { agents: agents.length, deleted, more: left <= 0 };
}

/** Frame time for retention: session start plus the frame's session time; a frame without t counts at the start. */
export const frameTimeMs = (startedAt: string, t: number | null) => Date.parse(startedAt) + (t ?? 0) * 1000;

// ---------------------------------------------------------------------------
// File backend
// ---------------------------------------------------------------------------

const fileOf = (name: string) => path.join(dataDir(), name);

async function readJson<T>(name: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(fileOf(name), "utf8")) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw err;
  }
}

async function writeJson(name: string, value: unknown): Promise<void> {
  await mkdir(dataDir(), { recursive: true });
  const tmp = `${fileOf(name)}.${randomUUID()}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, fileOf(name));
}

// One queue for the three files: read-modify-write never interleaves inside this process.
let fileQueue: Promise<unknown> = Promise.resolve();
function serial<T>(fn: () => Promise<T>): Promise<T> {
  const run = fileQueue.then(fn, fn);
  fileQueue = run.catch(() => undefined);
  return run;
}

type FileSession = {
  id: string;
  kind: "capture" | "teach";
  agent_id?: string;
  started_at: string;
  ended_at?: string;
  created_by?: string;
  frames?: { name: string; t: number }[];
};

async function fileSessions(): Promise<FileSession[]> {
  const list = await fileStore.listSessions();
  const out: FileSession[] = [];
  for (const s of list) {
    const full = (await fileStore.getSession(s.id)) as FileSession | null;
    if (full) out.push(full);
  }
  return out;
}

async function rewriteFrames(sessionId: string, drop: Set<string>): Promise<void> {
  const file = path.join(dataDir(), "sessions", sessionId, "session.json");
  const s = JSON.parse(await readFile(file, "utf8")) as FileSession;
  s.frames = (s.frames ?? []).filter((f) => !drop.has(f.name));
  if (s.frames.length === 0) delete s.frames;
  await writeFile(file, JSON.stringify(s, null, 2));
}

export function fileDataPort(): DataPort & RetentionPort {
  const removeObjects = async (paths: string[]) => {
    for (const p of paths) await rm(p, { force: true });
  };
  const deleteFrameRows = async (frames: FrameRef[]) => {
    const bySession = new Map<string, Set<string>>();
    for (const f of frames) bySession.set(f.session_id, (bySession.get(f.session_id) ?? new Set()).add(f.name));
    for (const [id, names] of bySession) await rewriteFrames(id, names);
  };
  return {
    async agentName(agentId) {
      return (await fileStore.getAgent(agentId))?.name ?? null;
    },
    async sessionsOf(agentId) {
      return (await fileSessions())
        .filter((s) => s.agent_id === agentId)
        .map((s) => ({ id: s.id, kind: s.kind, created_by: s.created_by ?? null, started_at: s.started_at, ended_at: s.ended_at ?? null }));
    },
    // The frames folder of each session (data/sessions/<id>/frames), not the session.json list.
    async frameObjectsOf(ids) {
      const out: string[] = [];
      for (const id of ids) {
        const names = await readdir(path.join(dataDir(), "sessions", id, "frames")).catch(() => [] as string[]);
        for (const name of names) out.push(framePath(id, name));
      }
      return out;
    },
    removeObjects,
    deleteFrameRows,
    // fileStore.deleteAgent removes the agent's sessions too (and their process tombstones); this covers the list.
    async deleteSessions(ids) {
      for (const id of ids) await rm(path.join(dataDir(), "sessions", id), { recursive: true, force: true });
    },
    async deleteAgent(agentId) {
      await fileStore.deleteAgent(agentId);
      await serial(async () => {
        const all = await readJson<Record<string, unknown>>("agent_settings.json", {});
        delete all[agentId];
        await writeJson("agent_settings.json", all);
        const reports = await readJson<AgentReport[]>("agent_reports.json", []);
        if (reports.some((r) => r.agent_id === agentId))
          await writeJson("agent_reports.json", reports.filter((r) => r.agent_id !== agentId));
        const reqs = await readJson<DeletionRequest[]>("agent_deletion_requests.json", []);
        await writeJson(
          "agent_deletion_requests.json",
          reqs.map((r) => (r.agent_id === agentId ? { ...r, agent_id: null } : r)),
        );
      });
    },
    async agents() {
      const settings = await readJson<Record<string, unknown>>("agent_settings.json", {});
      return (await fileStore.listAgents()).map((a) => ({ id: a.id, settings: settings[a.id] ?? {} }));
    },
    async oldFrames(agentId, cutoffMs, limit) {
      return (await fileSessions())
        .filter((s) => s.agent_id === agentId)
        .flatMap((s) =>
          (s.frames ?? [])
            .filter((f) => frameTimeMs(s.started_at, f.t) < cutoffMs)
            .map((f) => ({ session_id: s.id, name: f.name, path: framePath(s.id, f.name) })),
        )
        .slice(0, limit);
    },
  };
}

export function fileAgentAdmin(ctx: Pick<RequestContext, "workspaceId" | "userId">): AgentAdmin {
  const port = fileDataPort();
  const admin: AgentAdmin = {
    async getSettings(agentId) {
      const all = await readJson<Record<string, unknown>>("agent_settings.json", {});
      return { settings: resolveSettings(all[agentId]), available: true };
    },
    patchSettings(agentId, patch) {
      return serial(async () => {
        const all = await readJson<Record<string, AgentSettingsPatch>>("agent_settings.json", {});
        all[agentId] = { ...(all[agentId] ?? {}), ...patch };
        await writeJson("agent_settings.json", all);
        return resolveSettings(all[agentId]);
      });
    },
    async listRequests() {
      const all = await readJson<DeletionRequest[]>("agent_deletion_requests.json", []);
      return all.filter((r) => r.workspace_id === ctx.workspaceId).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
    requestDeletion(agentId, agentName) {
      return serial(async () => {
        const all = await readJson<DeletionRequest[]>("agent_deletion_requests.json", []);
        const open = all.find((r) => r.agent_id === agentId && r.status === "pending");
        if (open) return open;
        const req: DeletionRequest = {
          id: randomUUID(),
          workspace_id: ctx.workspaceId,
          agent_id: agentId,
          agent_name: agentName,
          requested_by: ctx.userId,
          created_at: new Date().toISOString(),
          status: "pending",
          decided_by: null,
          decided_at: null,
        };
        await writeJson("agent_deletion_requests.json", [...all, req]);
        return req;
      });
    },
    async getRequest(id) {
      return (await admin.listRequests()).find((r) => r.id === id) ?? null;
    },
    decide(id, status) {
      return serial(async () => {
        const all = await readJson<DeletionRequest[]>("agent_deletion_requests.json", []);
        const i = all.findIndex((r) => r.id === id && r.workspace_id === ctx.workspaceId && r.status === "pending");
        if (i < 0) throw new RequestNotFoundError(id);
        all[i] = { ...all[i], status, decided_by: ctx.userId, decided_at: new Date().toISOString() };
        await writeJson("agent_deletion_requests.json", all);
        return all[i];
      });
    },
    deleteAgentWithData(agentId) {
      return deleteAgentData(port, { workspaceId: ctx.workspaceId, agentId, userId: ctx.userId });
    },
    async creatorOf() {
      return null;
    },
  };
  return admin;
}

// ---------------------------------------------------------------------------
// Supabase backend
// ---------------------------------------------------------------------------

type PgResult<T> = { data: T | null; error: unknown };
function must<T>(what: string, res: PgResult<T>): T {
  if (res.error) {
    if (isMigrationMissing(res.error)) throw new SettingsUnavailableError();
    const msg = (res.error as { message?: string }).message ?? String(res.error);
    throw new Error(`${what}: ${msg}`);
  }
  return res.data as T;
}

const BUCKET = "frames";
const LIST_PAGE = 1000;

/** Admin (service role) port scoped to one workspace. Callers check the role first. */
export function supabaseDataPort(
  db: SupabaseClient,
  workspaceId: string,
): DataPort & Pick<RetentionPort, "removeObjects" | "deleteFrameRows"> {
  return {
    async agentName(agentId) {
      const row = must(
        "select agents",
        await db.from("agents").select("name").eq("workspace_id", workspaceId).eq("id", agentId).maybeSingle(),
      ) as { name: string } | null;
      return row?.name ?? null;
    },
    async sessionsOf(agentId) {
      return must(
        "select sessions",
        await db
          .from("sessions")
          .select("id,kind,created_by,started_at,ended_at")
          .eq("workspace_id", workspaceId)
          .eq("agent_id", agentId),
      ) as SessionRef[];
    },
    // Objects live at <workspaceId>/<sessionId>/<name>: list each session prefix, page by page.
    async frameObjectsOf(ids) {
      const out: string[] = [];
      for (const id of ids) {
        const prefix = `${workspaceId}/${id}`;
        for (let offset = 0; ; offset += LIST_PAGE) {
          const res = await db.storage.from(BUCKET).list(prefix, { limit: LIST_PAGE, offset });
          if (res.error) throw res.error;
          const names = (res.data ?? []).map((o) => o.name);
          out.push(...names.map((n) => `${prefix}/${n}`));
          if (names.length < LIST_PAGE) break;
        }
      }
      return out;
    },
    async removeObjects(paths) {
      const res = await db.storage.from(BUCKET).remove(paths);
      if (res.error) throw res.error;
    },
    async deleteFrameRows(frames) {
      const ids = [...new Set(frames.map((f) => f.session_id))];
      for (const id of ids) {
        const names = frames.filter((f) => f.session_id === id).map((f) => f.name);
        must("delete session_frames", await db.from("session_frames").delete().eq("session_id", id).in("name", names));
      }
    },
    // Child rows (events, transcript, Q&A, frames, tombstones) go with on delete cascade.
    async deleteSessions(ids) {
      for (const batch of chunks(ids, STORAGE_BATCH))
        must("delete sessions", await db.from("sessions").delete().eq("workspace_id", workspaceId).in("id", batch));
    },
    // Settings are a column; processes and versions cascade. A report of the earlier contract goes too.
    async deleteAgent(agentId) {
      must("delete agent_reports", await db.from("agent_reports").delete().eq("workspace_id", workspaceId).eq("agent_id", agentId));
      must("delete agents", await db.from("agents").delete().eq("workspace_id", workspaceId).eq("id", agentId));
    },
  };
}

/** Service role, every workspace. Only the cron route calls it. */
export function supabaseRetentionPort(db: SupabaseClient): RetentionPort {
  const data = supabaseDataPort(db, "");
  return {
    async agents() {
      return must("select agents", await db.from("agents").select("id,settings")) as { id: string; settings: unknown }[];
    },
    async oldFrames(agentId, cutoffMs, limit) {
      const sessions = must(
        "select sessions",
        await db.from("sessions").select("id,started_at").eq("agent_id", agentId).lt("started_at", new Date(cutoffMs).toISOString()),
      ) as { id: string; started_at: string }[];
      const out: FrameRef[] = [];
      for (const s of sessions) {
        if (out.length >= limit) break;
        const rows = must(
          "select session_frames",
          await db.from("session_frames").select("session_id,name,t,storage_path").eq("session_id", s.id).limit(limit - out.length),
        ) as { session_id: string; name: string; t: number | null; storage_path: string }[];
        for (const r of rows)
          if (frameTimeMs(s.started_at, r.t) < cutoffMs) out.push({ session_id: r.session_id, name: r.name, path: r.storage_path });
      }
      return out.slice(0, limit);
    },
    removeObjects: data.removeObjects,
    deleteFrameRows: data.deleteFrameRows,
  };
}

export function supabaseAgentAdmin(
  user: SupabaseClient,
  ctx: Pick<RequestContext, "workspaceId" | "userId">,
  adminClient: () => SupabaseClient = createSupabaseAdminClient,
): AgentAdmin {
  const ws = ctx.workspaceId;
  const admin: AgentAdmin = {
    async getSettings(agentId) {
      const res = await user.from("agents").select("settings").eq("workspace_id", ws).eq("id", agentId).maybeSingle();
      if (res.error && isMigrationMissing(res.error)) return { settings: resolveSettings({}), available: false };
      const row = must("select agents.settings", res) as { settings: unknown } | null;
      return { settings: resolveSettings(row?.settings), available: true };
    },
    async patchSettings(agentId, patch) {
      const clean = AgentSettingsPatch.parse(patch);
      const data = must(
        "rpc agent_settings_patch",
        await user.rpc("agent_settings_patch", { p_workspace: ws, p_agent: agentId, p_patch: clean }),
      );
      return resolveSettings(data);
    },
    async listRequests() {
      const res = await user.from("agent_deletion_requests").select("*").eq("workspace_id", ws).order("created_at", { ascending: false });
      if (res.error && isMigrationMissing(res.error)) return [];
      return must("select agent_deletion_requests", res) as DeletionRequest[];
    },
    async requestDeletion(agentId, agentName) {
      const res = await user
        .from("agent_deletion_requests")
        .insert({ workspace_id: ws, agent_id: agentId, agent_name: agentName, requested_by: ctx.userId })
        .select("*")
        .single();
      // 23505 on the partial unique index: a pending request exists, answer it.
      if (res.error && (res.error as { code?: string }).code === "23505") {
        const open = (await admin.listRequests()).find((r) => r.agent_id === agentId && r.status === "pending");
        if (open) return open;
      }
      return must("insert agent_deletion_requests", res) as DeletionRequest;
    },
    async getRequest(id) {
      return (await admin.listRequests()).find((r) => r.id === id) ?? null;
    },
    async decide(id, status) {
      const rows = must(
        "update agent_deletion_requests",
        await user
          .from("agent_deletion_requests")
          .update({ status, decided_by: ctx.userId, decided_at: new Date().toISOString() })
          .eq("workspace_id", ws)
          .eq("id", id)
          .eq("status", "pending")
          .select("*"),
      ) as DeletionRequest[];
      if (!rows.length) throw new RequestNotFoundError(id);
      return rows[0];
    },
    deleteAgentWithData(agentId) {
      return deleteAgentData(supabaseDataPort(adminClient(), ws), { workspaceId: ws, agentId, userId: ctx.userId });
    },
    async creatorOf(agentId) {
      const row = must(
        "select agents.created_by",
        await user.from("agents").select("created_by").eq("workspace_id", ws).eq("id", agentId).maybeSingle(),
      ) as { created_by: string | null } | null;
      return row?.created_by ?? null;
    },
  };
  return admin;
}

export function agentAdminFor(ctx: RequestContext): AgentAdmin {
  if (appMode() === "local" || !ctx.supabase) return fileAgentAdmin(ctx);
  return supabaseAgentAdmin(ctx.supabase, ctx);
}

/** Settings for a session's agent, read once when the session starts or a write is redacted. Defaults on any miss. */
export async function settingsForAgent(ctx: RequestContext, agentId: string | undefined | null): Promise<AgentSettings> {
  if (!agentId) return resolveSettings({});
  try {
    return (await agentAdminFor(ctx).getSettings(agentId)).settings;
  } catch {
    return resolveSettings({});
  }
}

const digest = (v: string) => createHash("sha256").update(v).digest();

/** Cron bearer check in constant time (fixed-length digests). Fails closed when the secret is unset or short. */
export function validCronBearer(header: string | null, secret: string | undefined): boolean {
  if (!secret || secret.length < 16 || !header) return false;
  return timingSafeEqual(digest(header), digest(`Bearer ${secret}`));
}
