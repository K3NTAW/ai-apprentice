// File backend: JSON files under DATA_DIR (default ./data), one directory per session.
// Moved from index.ts; only the shared helpers now come from ./types. Server only. Writes are serialised per session and land atomically (temp file + rename).
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { redactText } from "@/lib/redact";
import {
  AgentSchema,
  newId,
  SessionSchema,
  type Agent,
  type QAPair,
  type ScreenEvent,
  type Session,
  type SessionDigest,
  type TranscriptEntry,
  type WorkMap,
  WorkMapSchema,
} from "@/lib/types";
import {
  AgentNotFoundError,
  assertFrameName,
  assertId,
  assertRange,
  frameName,
  hasOpenRange,
  inRange,
  isOffRecord,
  isValidAgentId,
  isValidProcessId,
  isValidSessionId,
  processNewestFirst,
  processPatchValues,
  ProcessExistsError,
  ProcessNotFoundError,
  ProcessVersionConflictError,
  recognizersFromSettings,
  redactOpts,
  SessionNotFoundError,
  type AgentInput,
  type AgentPatch,
  type ListProcessesOptions,
  type OffRecordRange,
  type Process,
  type ProcessChangeKind,
  type ProcessInput,
  type ProcessPatch,
  type ProcessVersion,
  type SaveFrameResult,
  type SessionStore,
  RECENT_SESSIONS_DEFAULT,
  type SessionSummary,
} from "./types";

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

const sessionsDir = () => path.join(dataDir(), "sessions");
const sessionDir = (id: string) => path.join(sessionsDir(), id);
const sessionFile = (id: string) => path.join(sessionDir(id), "session.json");

export function framePath(id: string, name: string): string {
  assertId(id);
  assertFrameName(name);
  return path.join(sessionDir(id), "frames", name);
}

// Per-session write queue: each mutation runs after the previous one settles.
// Kept on globalThis because route handlers are bundled separately and would otherwise each get their own Map.
const QUEUES_KEY = Symbol.for("apprentice.store.writeQueues");
const queues: Map<string, Promise<unknown>> = ((globalThis as Record<symbol, unknown>)[QUEUES_KEY] ??= new Map<
  string,
  Promise<unknown>
>()) as Map<string, Promise<unknown>>;

function enqueue<T>(id: string, fn: () => Promise<T>): Promise<T> {
  const prev = queues.get(id) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  const tail = run.catch(() => undefined);
  queues.set(id, tail);
  void tail.then(() => {
    if (queues.get(id) === tail) queues.delete(id);
  });
  return run;
}

async function readSession(id: string): Promise<Session | null> {
  let raw: string;
  try {
    raw = await readFile(sessionFile(id), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
  return SessionSchema.parse(JSON.parse(raw));
}

async function writeAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2));
  await rename(tmp, file);
}

function writeSession(s: Session): Promise<void> {
  return writeAtomic(sessionFile(s.id), s);
}

async function mutate(id: string, fn: (s: Session) => void | Promise<void>): Promise<Session> {
  assertId(id);
  return enqueue(id, async () => {
    const s = await readSession(id);
    if (!s) throw new SessionNotFoundError(id);
    await fn(s);
    await writeSession(s);
    return s;
  });
}

// Agents: one JSON array in data/agents.json, written atomically (temp file + rename) through one write queue.
// Local mode has a single 'local' workspace and the owner role; roles are checked by the routes.
// Ids are randomUUID(), like gen_random_uuid() in the DB.
const agentsFile = () => path.join(dataDir(), "agents.json");
// Not a valid session id, so it never shares a queue with a session.
const AGENTS_QUEUE = "\0agents";
const LOCAL_WORKSPACE = "local";

async function readAgents(): Promise<Agent[]> {
  let raw: string;
  try {
    raw = await readFile(agentsFile(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  return AgentSchema.array().parse(JSON.parse(raw));
}

function mutateAgents<T>(fn: (agents: Agent[]) => { agents: Agent[]; result: T }): Promise<T> {
  return enqueue(AGENTS_QUEUE, async () => {
    const { agents, result } = fn(await readAgents());
    await writeAtomic(agentsFile(), agents);
    return result;
  });
}

const newestFirst = (a: Agent, b: Agent) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

async function listAgents(): Promise<Agent[]> {
  return (await readAgents()).sort(newestFirst);
}

async function getAgent(id: string): Promise<Agent | null> {
  if (!isValidAgentId(id)) return null;
  return (await readAgents()).find((a) => a.id === id) ?? null;
}

function createAgent(input: AgentInput): Promise<Agent> {
  const now = new Date().toISOString();
  const agent = AgentSchema.parse({
    id: randomUUID(),
    workspace_id: LOCAL_WORKSPACE,
    name: input.name,
    role: input.role,
    ...(input.expert_name ? { expert_name: input.expert_name } : {}),
    avatar: input.avatar,
    created_at: now,
    updated_at: now,
  });
  return mutateAgents((agents) => ({ agents: [...agents, agent], result: agent }));
}

function updateAgent(id: string, patch: AgentPatch): Promise<Agent> {
  if (!isValidAgentId(id)) return Promise.reject(new AgentNotFoundError(id));
  return mutateAgents((agents) => {
    const i = agents.findIndex((a) => a.id === id);
    if (i < 0) throw new AgentNotFoundError(id);
    const { expert_name, ...rest } = agents[i];
    const keep = patch.expert_name === undefined ? expert_name : patch.expert_name || undefined;
    const next = AgentSchema.parse({
      ...rest,
      ...(patch.name !== undefined ? { name: patch.name } : {}),
      ...(patch.role !== undefined ? { role: patch.role } : {}),
      ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
      ...(keep ? { expert_name: keep } : {}),
      updated_at: new Date().toISOString(),
    });
    return { agents: agents.map((a, j) => (j === i ? next : a)), result: next };
  });
}

// Like on delete set null (agent_id): sessions stay, the link goes. The links are cleared inside the
// agents write queue, so the next agents write only runs once they are gone.
function deleteAgent(id: string): Promise<boolean> {
  if (!isValidAgentId(id)) return Promise.resolve(false);
  return enqueue(AGENTS_QUEUE, async () => {
    const agents = await readAgents();
    const left = agents.filter((a) => a.id !== id);
    if (left.length === agents.length) return false;
    await writeAtomic(agentsFile(), left);
    await deleteProcessesWhere((p) => p.agent_id === id);
    for (const s of await readSessions()) {
      if (s.agent_id !== id) continue;
      await mutate(s.id, (x) => {
        if (x.agent_id === id) delete x.agent_id;
      }).catch((err) => {
        if (!(err instanceof SessionNotFoundError)) throw err;
      });
    }
    return true;
  });
}

/**
 * Readers treat an agent_id with no matching agent as absent (a session created while its agent was being deleted).
 * The stored file keeps the id; only the returned value drops it.
 */
function withoutDanglingAgent<T extends { agent_id?: string }>(s: T, agentIds: Set<string>): T {
  if (s.agent_id === undefined || agentIds.has(s.agent_id)) return s;
  const rest = { ...s };
  delete rest.agent_id;
  return rest;
}

async function agentIdSet(): Promise<Set<string>> {
  return new Set((await readAgents()).map((a) => a.id));
}

async function createSession(input: { kind: Session["kind"]; expert?: string; agent_id?: string }): Promise<Session> {
  if (input.agent_id !== undefined && !(await getAgent(input.agent_id))) throw new AgentNotFoundError(input.agent_id);
  const s: Session = {
    id: newId("s"),
    kind: input.kind,
    started_at: new Date().toISOString(),
    ...(input.expert ? { expert: input.expert } : {}),
    ...(input.agent_id ? { agent_id: input.agent_id } : {}),
    events: [],
    transcript: [],
    qa: [],
    off_record_ranges: [],
  };
  await enqueue(s.id, () => writeSession(s));
  return s;
}

async function getSession(id: string): Promise<Session | null> {
  assertId(id);
  const s = await readSession(id);
  if (!s?.agent_id) return s;
  return withoutDanglingAgent(s, await agentIdSet());
}

async function listSessions(): Promise<SessionSummary[]> {
  const sessions = await readSessions();
  if (!sessions.some((s) => s.agent_id)) return sessions;
  const agentIds = await agentIdSet();
  return sessions.map((s) => withoutDanglingAgent(s, agentIds));
}

/** Local mode has no users: created_by is null. */
async function listSessionDigests(): Promise<SessionDigest[]> {
  const out: SessionDigest[] = [];
  for (const sum of await listSessions()) {
    const s = await readSession(sum.id).catch(() => null);
    if (!s) continue;
    out.push({
      id: s.id,
      kind: s.kind,
      started_at: s.started_at,
      ...(s.ended_at !== undefined ? { ended_at: s.ended_at } : {}),
      ...(s.expert !== undefined ? { expert: s.expert } : {}),
      ...(s.workmap ? { workmap: s.workmap } : {}),
      off_record_ranges: s.off_record_ranges,
      ...(s.teach ? { teach: s.teach } : {}),
      ...(sum.agent_id ? { agent_id: sum.agent_id } : {}),
      ...(s.process_id ? { process_id: s.process_id } : {}),
      created_by: null,
    });
  }
  return out;
}

async function recentSessions(limit = RECENT_SESSIONS_DEFAULT): Promise<SessionSummary[]> {
  return (await listSessions()).slice(0, Math.max(0, limit));
}

/** Every session summary as stored, links included. */
async function readSessions(): Promise<SessionSummary[]> {
  let ids: string[];
  try {
    ids = await readdir(sessionsDir());
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  const out: SessionSummary[] = [];
  for (const id of ids.filter(isValidSessionId)) {
    const s = await readSession(id).catch(() => null);
    if (!s) continue;
    out.push({
      id: s.id,
      kind: s.kind,
      started_at: s.started_at,
      ended_at: s.ended_at,
      expert: s.expert,
      counts: { events: s.events.length, transcript: s.transcript.length, qa: s.qa.length },
      has_workmap: s.workmap !== undefined,
      ...(s.agent_id ? { agent_id: s.agent_id } : {}),
      ...(s.workmap ? { task: s.workmap.task, confirmed: s.workmap.confirmed_by_expert } : {}),
      ...(s.teach ? { mastered: s.teach.mastered.length, practiced: new Set([...s.teach.mastered, ...s.teach.practice]).size } : {}),
    });
  }
  return out.sort((a, b) => b.started_at.localeCompare(a.started_at));
}

function appendEvents(id: string, events: ScreenEvent[]): Promise<Session> {
  return mutate(id, (s) => {
    if (hasOpenRange(s.off_record_ranges)) return;
    s.events.push(...events.filter((e) => !isOffRecord(s.off_record_ranges, e.t)));
  });
}

/** The session agent's recognizer groups from data/agent_settings.json (see src/lib/agents/admin.ts). */
async function agentRecognizers(agentId: string | undefined) {
  if (!agentId) return recognizersFromSettings({});
  try {
    const all = JSON.parse(await readFile(path.join(dataDir(), "agent_settings.json"), "utf8")) as Record<string, unknown>;
    return recognizersFromSettings(all[agentId]);
  } catch {
    return recognizersFromSettings({});
  }
}

function appendTranscript(id: string, entries: TranscriptEntry[]): Promise<Session> {
  return mutate(id, async (s) => {
    if (hasOpenRange(s.off_record_ranges)) return;
    const opts = redactOpts(s.expert, await agentRecognizers(s.agent_id));
    for (const e of entries) {
      if (isOffRecord(s.off_record_ranges, e.t)) continue;
      s.transcript.push({ ...e, text: redactText(e.text, opts).text, redacted: true });
    }
  });
}

function upsertQA(id: string, qa: QAPair): Promise<Session> {
  return mutate(id, async (s) => {
    const opts = redactOpts(s.expert, await agentRecognizers(s.agent_id));
    const clean: QAPair = {
      ...qa,
      question: redactText(qa.question, opts).text,
      ...(qa.answer !== undefined ? { answer: redactText(qa.answer, opts).text } : {}),
    };
    const i = s.qa.findIndex((q) => q.id === qa.id);
    if (i >= 0) s.qa[i] = clean;
    else s.qa.push(clean);
  });
}

/**
 * Opens a range ({from}) or closes one ({from, to}). Data already stored inside a closed range is purged.
 * Rejects with InvalidOffRecordRangeError when to < from; stored ranges stay untouched.
 */
function setOffRecord(id: string, range: { from: number; to?: number }): Promise<Session> {
  return mutate(id, async (s) => {
    assertRange(range);
    const open = s.off_record_ranges.find((r) => r.to === undefined);
    if (range.to === undefined) {
      if (!open) s.off_record_ranges.push({ from: range.from });
      return;
    }
    let closed: OffRecordRange;
    if (open) {
      open.from = Math.min(open.from, range.from);
      open.to = range.to;
      closed = open;
    } else {
      closed = { from: range.from, to: range.to };
      s.off_record_ranges.push(closed);
    }
    s.events = s.events.filter((e) => !inRange(e.t, closed));
    s.transcript = s.transcript.filter((e) => !inRange(e.t, closed));
    if (s.frames) {
      const purge = s.frames.filter((f) => inRange(f.t, closed));
      for (const f of purge) await rm(framePath(id, f.name), { force: true });
      s.frames = s.frames.filter((f) => !inRange(f.t, closed));
    }
  });
}

function saveWorkMap(id: string, workmap: WorkMap): Promise<Session> {
  return mutate(id, (s) => {
    s.workmap = workmap;
  });
}

function endSession(id: string): Promise<Session> {
  return mutate(id, (s) => {
    s.ended_at ??= new Date().toISOString();
  });
}

/**
 * Writes one frame captured at t and records {name, t} on the session so off-record purges can find it.
 * Skips the write when t is inside an off-record range or a range is open.
 * Without a session.json the frame is written unrecorded (no ranges can apply).
 */
function saveFrame(id: string, t: number, data: Buffer): Promise<SaveFrameResult> {
  assertId(id);
  const name = frameName(t);
  return enqueue(id, async (): Promise<SaveFrameResult> => {
    const s = await readSession(id);
    if (s && (hasOpenRange(s.off_record_ranges) || isOffRecord(s.off_record_ranges, t))) return { stored: false, reason: "off_record" };
    const file = framePath(id, name);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, data);
    if (s) {
      s.frames = [...(s.frames ?? []).filter((f) => f.name !== name), { name, t }];
      await writeSession(s);
    }
    return { stored: true, name };
  });
}

async function readFrame(id: string, name: string): Promise<Buffer | null> {
  try {
    return await readFile(framePath(id, name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}

// Processes: data/processes.json holds { processes, versions } and is written atomically through one write queue,
// so a process and its version rows always land together. Local mode: workspace 'local', created_by and
// changed_by null. Like on delete cascade: deleting the agent deletes its processes; deleting a process deletes its
// versions and clears sessions.process_id.
type ProcessData = { processes: Process[]; versions: ProcessVersion[] };
const processesFile = () => path.join(dataDir(), "processes.json");
// Not a valid session id, so it never shares a queue with a session.
const PROCESSES_QUEUE = "\0processes";

async function readProcessData(): Promise<ProcessData> {
  let raw: string;
  try {
    raw = await readFile(processesFile(), "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return { processes: [], versions: [] };
    throw err;
  }
  const d = JSON.parse(raw) as Partial<ProcessData>;
  return { processes: d.processes ?? [], versions: d.versions ?? [] };
}

/** fn mutates d in place; a throw leaves the file untouched. */
function mutateProcesses<T>(fn: (d: ProcessData) => T): Promise<T> {
  return enqueue(PROCESSES_QUEUE, async () => {
    const d = await readProcessData();
    const result = fn(d);
    await writeAtomic(processesFile(), d);
    return result;
  });
}

function versionRow(p: Process, kind: ProcessChangeKind, sourceSessionId: string | undefined): ProcessVersion {
  return {
    id: randomUUID(),
    process_id: p.id,
    version: p.version,
    workmap: p.workmap,
    source_session_id: sourceSessionId ?? null,
    change_kind: kind,
    changed_by: null,
    created_at: p.updated_at,
  };
}

async function requireSession(id: string | undefined): Promise<void> {
  if (id === undefined) return;
  assertId(id);
  if (!(await readSession(id))) throw new SessionNotFoundError(id);
}

async function setSessionProcess(sessionId: string, processId: string): Promise<void> {
  await mutate(sessionId, (s) => {
    s.process_id = processId;
  });
}

async function listProcesses(opts: ListProcessesOptions = {}): Promise<Process[]> {
  return (await readProcessData()).processes
    .filter((p) => (opts.agent_id === undefined || p.agent_id === opts.agent_id) && (opts.include_archived || !p.archived_at))
    .sort(processNewestFirst);
}

async function getProcess(id: string): Promise<Process | null> {
  if (!isValidProcessId(id)) return null;
  return (await readProcessData()).processes.find((p) => p.id === id) ?? null;
}

// One process per source session (like processes_source_session_key): the check runs inside the write queue, so
// two concurrent backfills create each process once. backfill keeps the session's started_at as created_at.
async function createProcess(input: ProcessInput): Promise<Process> {
  if (!(await getAgent(input.agent_id))) throw new AgentNotFoundError(input.agent_id);
  await requireSession(input.source_session_id);
  const workmap = WorkMapSchema.parse(input.workmap);
  const now = new Date().toISOString();
  const src = input.backfill && input.source_session_id ? await readSession(input.source_session_id) : null;
  const p: Process = {
    id: randomUUID(),
    workspace_id: LOCAL_WORKSPACE,
    agent_id: input.agent_id,
    title: input.title,
    workmap,
    version: 1,
    confirmed: workmap.confirmed_by_expert === true,
    archived_at: null,
    created_by: null,
    created_at: src?.started_at ?? now,
    updated_at: now,
  };
  await mutateProcesses((d) => {
    const sid = input.source_session_id;
    if (sid && d.versions.some((v) => v.version === 1 && v.source_session_id === sid && d.processes.some((x) => x.id === v.process_id)))
      throw new ProcessExistsError(sid);
    d.processes.push(p);
    d.versions.push(versionRow(p, "trained", input.source_session_id));
  });
  if (input.source_session_id) await setSessionProcess(input.source_session_id, p.id);
  return p;
}

async function updateProcess(id: string, patch: ProcessPatch): Promise<Process> {
  if (!isValidProcessId(id)) throw new ProcessNotFoundError(id);
  await requireSession(patch.source_session_id);
  const workmap = patch.workmap !== undefined ? WorkMapSchema.parse(patch.workmap) : undefined;
  const next = await mutateProcesses((d) => {
    const i = d.processes.findIndex((p) => p.id === id);
    if (i < 0) throw new ProcessNotFoundError(id);
    // Optimistic concurrency, checked inside the write queue so the check and both writes are one step.
    if (workmap && patch.expected_version !== undefined && d.processes[i].version !== patch.expected_version)
      throw new ProcessVersionConflictError(id, patch.expected_version);
    const p: Process = { ...d.processes[i], ...processPatchValues(d.processes[i], { ...patch, workmap }, new Date().toISOString()) };
    d.processes[i] = p;
    if (workmap) d.versions.push(versionRow(p, patch.change_kind ?? "edited", patch.source_session_id));
    return p;
  });
  if (patch.source_session_id) await setSessionProcess(patch.source_session_id, id);
  return next;
}

/** Deletes the matching processes and their versions, then clears sessions.process_id. Returns the deleted ids. */
async function deleteProcessesWhere(match: (p: Process) => boolean): Promise<string[]> {
  const gone = await mutateProcesses((d) => {
    const ids = d.processes.filter(match).map((p) => p.id);
    d.processes = d.processes.filter((p) => !ids.includes(p.id));
    d.versions = d.versions.filter((v) => !ids.includes(v.process_id));
    return ids;
  });
  if (gone.length === 0) return gone;
  for (const sum of await readSessions()) {
    const s = await readSession(sum.id).catch(() => null);
    if (!s?.process_id || !gone.includes(s.process_id)) continue;
    await mutate(s.id, (x) => {
      if (x.process_id && gone.includes(x.process_id)) delete x.process_id;
    }).catch((err) => {
      if (!(err instanceof SessionNotFoundError)) throw err;
    });
  }
  return gone;
}

async function deleteProcess(id: string): Promise<boolean> {
  if (!isValidProcessId(id)) return false;
  return (await deleteProcessesWhere((p) => p.id === id)).length > 0;
}

async function listProcessVersions(processId: string): Promise<ProcessVersion[]> {
  if (!isValidProcessId(processId)) return [];
  return (await readProcessData()).versions.filter((v) => v.process_id === processId).sort((a, b) => b.version - a.version);
}

export const fileStore: SessionStore = {
  createSession,
  getSession,
  listSessions,
  listSessionDigests,
  recentSessions,
  appendEvents,
  appendTranscript,
  upsertQA,
  setOffRecord,
  saveWorkMap,
  endSession,
  saveFrame,
  readFrame,
  listAgents,
  getAgent,
  createAgent,
  updateAgent,
  deleteAgent,
  listProcesses,
  getProcess,
  createProcess,
  updateProcess,
  deleteProcess,
  listProcessVersions,
};
