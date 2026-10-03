// Local session store: JSON files under DATA_DIR (default ./data), one directory per session.
// Server only. Writes are serialised per session and land atomically (temp file + rename).
import { randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { redactText, type RedactOptions } from "@/lib/redact";
import {
  newId,
  SessionSchema,
  type QAPair,
  type ScreenEvent,
  type Session,
  type TranscriptEntry,
  type WorkMap,
} from "@/lib/types";

export type SessionSummary = {
  id: string;
  kind: Session["kind"];
  started_at: string;
  ended_at?: string;
  expert?: string;
  counts: { events: number; transcript: number; qa: number };
  has_workmap: boolean;
};

export type OffRecordRange = Session["off_record_ranges"][number];

const ID_RE = /^[a-zA-Z0-9_-]+$/;
const FRAME_RE = /^[0-9a-zA-Z_-]+\.jpg$/;

export class InvalidSessionIdError extends Error {
  constructor(id: string) {
    super(`invalid session id: ${JSON.stringify(id)}`);
    this.name = "InvalidSessionIdError";
  }
}

export class SessionNotFoundError extends Error {
  constructor(id: string) {
    super(`session not found: ${id}`);
    this.name = "SessionNotFoundError";
  }
}

export class InvalidOffRecordRangeError extends Error {
  constructor(range: { from: number; to?: number }) {
    super(`invalid off-record range: to (${range.to}) is before from (${range.from})`);
    this.name = "InvalidOffRecordRangeError";
  }
}

export function isValidSessionId(id: string): boolean {
  return ID_RE.test(id);
}

export function isValidFrameName(name: string): boolean {
  return FRAME_RE.test(name);
}

function assertId(id: string): void {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new InvalidSessionIdError(String(id));
}

export function dataDir(): string {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

const sessionsDir = () => path.join(dataDir(), "sessions");
const sessionDir = (id: string) => path.join(sessionsDir(), id);
const sessionFile = (id: string) => path.join(sessionDir(id), "session.json");

export function framePath(id: string, name: string): string {
  assertId(id);
  if (!FRAME_RE.test(name)) throw new Error(`invalid frame name: ${JSON.stringify(name)}`);
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

async function mutate(id: string, fn: (s: Session) => void): Promise<Session> {
  assertId(id);
  return enqueue(id, async () => {
    const s = await readSession(id);
    if (!s) throw new SessionNotFoundError(id);
    fn(s);
    await writeSession(s);
    return s;
  });
}

const hasOpenRange = (s: Session) => s.off_record_ranges.some((r) => r.to === undefined);
const inRange = (t: number, r: OffRecordRange) => t >= r.from && (r.to === undefined || t <= r.to);
const isOffRecord = (s: Session, t: number) => s.off_record_ranges.some((r) => inRange(t, r));

function redactOpts(s: Session): RedactOptions {
  const first = s.expert?.trim().split(/\s+/)[0];
  return first ? { keepNames: [first] } : {};
}

export async function createSession(input: { kind: Session["kind"]; expert?: string }): Promise<Session> {
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

export async function getSession(id: string): Promise<Session | null> {
  assertId(id);
  return readSession(id);
}

export async function listSessions(): Promise<SessionSummary[]> {
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

export function appendEvents(id: string, events: ScreenEvent[]): Promise<Session> {
  return mutate(id, (s) => {
    if (hasOpenRange(s)) return;
    s.events.push(...events.filter((e) => !isOffRecord(s, e.t)));
  });
}

export function appendTranscript(id: string, entries: TranscriptEntry[]): Promise<Session> {
  return mutate(id, (s) => {
    if (hasOpenRange(s)) return;
    const opts = redactOpts(s);
    for (const e of entries) {
      if (isOffRecord(s, e.t)) continue;
      s.transcript.push({ ...e, text: redactText(e.text, opts).text, redacted: true });
    }
  });
}

export function upsertQA(id: string, qa: QAPair): Promise<Session> {
  return mutate(id, (s) => {
    const opts = redactOpts(s);
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
export function setOffRecord(id: string, range: { from: number; to?: number }): Promise<Session> {
  return mutate(id, (s) => {
    if (range.to !== undefined && range.to < range.from) throw new InvalidOffRecordRangeError(range);
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
  });
}

export function saveWorkMap(id: string, workmap: WorkMap): Promise<Session> {
  return mutate(id, (s) => {
    s.workmap = workmap;
  });
}

export function endSession(id: string): Promise<Session> {
  return mutate(id, (s) => {
    s.ended_at ??= new Date().toISOString();
  });
}

export async function readFrame(id: string, name: string): Promise<Buffer | null> {
  try {
    return await readFile(framePath(id, name));
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw err;
  }
}
