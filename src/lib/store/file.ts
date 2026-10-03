// File backend: JSON files under DATA_DIR (default ./data), one directory per session.
// Moved from index.ts; only the shared helpers now come from ./types. Server only. Writes are serialised per session and land atomically (temp file + rename).
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { redactText } from "@/lib/redact";
import {
  newId,
  SessionSchema,
  type QAPair,
  type ScreenEvent,
  type Session,
  type TranscriptEntry,
  type WorkMap,
} from "@/lib/types";
import {
  assertFrameName,
  assertId,
  assertRange,
  frameName,
  hasOpenRange,
  inRange,
  isOffRecord,
  isValidSessionId,
  redactOpts,
  SessionNotFoundError,
  type OffRecordRange,
  type SaveFrameResult,
  type SessionStore,
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

async function writeSession(s: Session): Promise<void> {
  const file = sessionFile(s.id);
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${randomBytes(6).toString("hex")}.tmp`;
  await writeFile(tmp, JSON.stringify(s, null, 2));
  await rename(tmp, file);
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

async function createSession(input: { kind: Session["kind"]; expert?: string }): Promise<Session> {
  const s: Session = {
    id: newId("s"),
    kind: input.kind,
    started_at: new Date().toISOString(),
    ...(input.expert ? { expert: input.expert } : {}),
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
  return readSession(id);
}

async function listSessions(): Promise<SessionSummary[]> {
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

function appendTranscript(id: string, entries: TranscriptEntry[]): Promise<Session> {
  return mutate(id, (s) => {
    if (hasOpenRange(s.off_record_ranges)) return;
    const opts = redactOpts(s.expert);
    for (const e of entries) {
      if (isOffRecord(s.off_record_ranges, e.t)) continue;
      s.transcript.push({ ...e, text: redactText(e.text, opts).text, redacted: true });
    }
  });
}

function upsertQA(id: string, qa: QAPair): Promise<Session> {
  return mutate(id, (s) => {
    const opts = redactOpts(s.expert);
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

export const fileStore: SessionStore = {
  createSession,
  getSession,
  listSessions,
  appendEvents,
  appendTranscript,
  upsertQA,
  setOffRecord,
  saveWorkMap,
  endSession,
  saveFrame,
  readFrame,
};
