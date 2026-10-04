// Store contract shared by the file and supabase backends. Leaf module: imports nothing from ./index, ./file or ./supabase.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RedactOptions } from "@/lib/redact";
import type { Agent, Avatar, QAPair, ScreenEvent, Session, SessionDigest, TeachProgress, TranscriptEntry, WorkMap } from "@/lib/types";

export type SessionSummary = {
  id: string;
  kind: Session["kind"];
  started_at: string;
  ended_at?: string;
  expert?: string;
  counts: { events: number; transcript: number; qa: number };
  has_workmap: boolean;
  agent_id?: string;
  /** Work Map title (workmap.task) when the session has one; the sidebar titles read it. */
  task?: string;
  /** workmap.confirmed_by_expert. */
  confirmed?: boolean;
  /** Teach progress counts (Session.teach) where the backend stores them. */
  mastered?: number;
  practiced?: number;
  /** An ended capture with no recorded work (lib/capture/empty): the sidebar shows 'No work recorded'. */
  empty?: boolean;
  /** Who started the session, where the backend stores it (the recent list's Delete: creator or owner). */
  created_by?: string;
};

export const RECENT_SESSIONS_DEFAULT = 6;

export type AgentInput = { name: string; role: string; expert_name?: string; avatar: Avatar };
/** PATCH semantics: given keys replace the stored value (avatar as a whole); expert_name null clears it. */
export type AgentPatch = { name?: string; role?: string; expert_name?: string | null; avatar?: Avatar };

export type OffRecordRange = Session["off_record_ranges"][number];

export const PROCESS_TITLE_MAX = 120;
export const PROCESS_CHANGE_KINDS = ["trained", "extended", "replaced", "edited"] as const;
export type ProcessChangeKind = (typeof PROCESS_CHANGE_KINDS)[number];

/** A process of an agent: the merged, current Work Map plus its version counter (table public.processes). */
export type Process = {
  id: string;
  workspace_id: string;
  agent_id: string;
  title: string;
  workmap: WorkMap;
  version: number;
  confirmed: boolean;
  archived_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** One row per Work Map change of a process (table public.process_versions). Append-only. */
export type ProcessVersion = {
  id: string;
  process_id: string;
  version: number;
  workmap: WorkMap;
  source_session_id: string | null;
  change_kind: ProcessChangeKind;
  changed_by: string | null;
  created_at: string;
};

/**
 * source_session_id links the session to the new process (sessions.process_id) and is kept on version 1. At most
 * one process per source session: a second create throws ProcessExistsError and writes nothing.
 * backfill (needs source_session_id) keeps the session's started_at as created_at, so the order is unchanged.
 * confirmed is derived from workmap.confirmed_by_expert, never given.
 */
export type ProcessInput = {
  agent_id: string;
  title: string;
  workmap: WorkMap;
  source_session_id?: string;
  backfill?: boolean;
};

/**
 * PATCH semantics, all keys in one transaction. A new workmap bumps version and adds a process_versions row with
 * change_kind (default 'edited') and source_session_id (which is also linked to the process). The Work Map change
 * is conditional on expected_version (default: the version read just before); a mismatch throws
 * ProcessVersionConflictError and writes nothing, title and archive included. confirmed follows
 * workmap.confirmed_by_expert. archived true archives now, false restores. Title or archive alone add no version.
 */
export type ProcessPatch = {
  title?: string;
  workmap?: WorkMap;
  expected_version?: number;
  archived?: boolean;
  change_kind?: ProcessChangeKind;
  source_session_id?: string;
};

export type ListProcessesOptions = { agent_id?: string; include_archived?: boolean };

export type SaveFrameResult = { stored: true; name: string } | { stored: false; reason: "off_record" };

export interface SessionStore {
  /** agent_id must name an agent of the same workspace, else AgentNotFoundError. */
  createSession(input: { kind: Session["kind"]; expert?: string; agent_id?: string }): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  /** Newest first, with child row counts. Supabase: one query per page (embedded counts). */
  listSessions(): Promise<SessionSummary[]>;
  /** Every session newest first without child rows: one query per page. Stats, the control room and /api/workmaps read this. */
  listSessionDigests(): Promise<SessionDigest[]>;
  /** Newest first, at most limit (default RECENT_SESSIONS_DEFAULT). For lists only: counts may be zero (supabase skips them). */
  recentSessions(limit?: number): Promise<SessionSummary[]>;
  appendEvents(id: string, events: ScreenEvent[]): Promise<Session>;
  appendTranscript(id: string, entries: TranscriptEntry[]): Promise<Session>;
  upsertQA(id: string, qa: QAPair): Promise<Session>;
  setOffRecord(id: string, range: { from: number; to?: number }): Promise<Session>;
  saveWorkMap(id: string, workmap: WorkMap): Promise<Session>;
  endSession(id: string): Promise<Session>;
  /** Replaces Session.teach. Supabase throws TeachUnavailableError while migration 20261004040000_session_teach is not applied. */
  saveTeach(id: string, teach: TeachProgress): Promise<Session>;
  saveFrame(id: string, t: number, data: Buffer): Promise<SaveFrameResult>;
  readFrame(id: string, name: string): Promise<Buffer | null>;
  /** Newest first. */
  listAgents(): Promise<Agent[]>;
  /** null for a missing agent, an agent of another workspace and a malformed id alike. */
  getAgent(id: string): Promise<Agent | null>;
  createAgent(input: AgentInput): Promise<Agent>;
  /** Throws AgentNotFoundError when missing or outside the workspace. */
  updateAgent(id: string, patch: AgentPatch): Promise<Agent>;
  /** False when missing or outside the workspace. Its sessions (with their child rows), processes and versions go too. */
  deleteAgent(id: string): Promise<boolean>;
  // Processes. Supabase throws ProcessesUnavailableError while migration 20261004030000_processes is not applied.
  // Ids are UUIDs; a malformed id reads as missing. A process of another workspace is missing.
  /** Newest first; archived processes only with include_archived. */
  listProcesses(opts?: ListProcessesOptions): Promise<Process[]>;
  getProcess(id: string): Promise<Process | null>;
  /** Version 1 plus its process_versions row ('trained'). AgentNotFoundError / SessionNotFoundError for bad links. */
  createProcess(input: ProcessInput): Promise<Process>;
  /** Throws ProcessNotFoundError when missing or outside the workspace. */
  updateProcess(id: string, patch: ProcessPatch): Promise<Process>;
  /** False when missing. Versions go with it; linked sessions keep their history, their process_id is cleared. */
  deleteProcess(id: string): Promise<boolean>;
  /** Newest version first. Empty for a missing process. */
  listProcessVersions(processId: string): Promise<ProcessVersion[]>;
}

/**
 * Built by the caller from the request context. userId must be the authenticated user of supabase:
 * the sessions insert policy requires created_by = auth.uid(), otherwise createSession throws.
 */
export type StoreContext = { supabase: SupabaseClient; workspaceId: string; userId: string };

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

export class AgentNotFoundError extends Error {
  constructor(id: string) {
    super(`agent not found: ${id}`);
    this.name = "AgentNotFoundError";
  }
}

export class ProcessNotFoundError extends Error {
  constructor(id: string) {
    super(`process not found: ${id}`);
    this.name = "ProcessNotFoundError";
  }
}

/** A Work Map edit based on a stale version: another edit landed first. The API answers 409. */
export class ProcessVersionConflictError extends Error {
  readonly code = "process_version_conflict";
  constructor(id: string, expected: number) {
    super(`process ${id} is no longer at version ${expected}`);
    this.name = "ProcessVersionConflictError";
  }
}

/** A process for this source session exists already (one process per source session). The API answers 409. */
export class ProcessExistsError extends Error {
  readonly code = "process_exists";
  constructor(sessionId: string) {
    super(`a process for session ${sessionId} exists already`);
    this.name = "ProcessExistsError";
  }
}

/** A process patch with nothing to change (update_process raises 22023 'nothing to update'). The API answers 400. */
export class EmptyProcessPatchError extends Error {
  readonly code = "nothing_to_update";
  constructor() {
    super("nothing to update");
    this.name = "EmptyProcessPatchError";
  }
}

/** The session is linked to another process already; a process never takes over another's session. The API answers 409. */
export class SessionLinkedError extends Error {
  readonly code = "session_linked";
  constructor(sessionId: string) {
    super(`session ${sessionId} is linked to another process`);
    this.name = "SessionLinkedError";
  }
}

/** A backfill for a session whose process was deleted (processes_tombstones): deleted processes stay deleted. */
export class ProcessDeletedError extends Error {
  readonly code = "process_deleted";
  constructor(sessionId: string) {
    super(`the process for session ${sessionId} was deleted`);
    this.name = "ProcessDeletedError";
  }
}

/** The database rejected a Work Map (update_process / create_process, workmap_valid). The API answers 400. */
export class InvalidWorkMapError extends Error {
  readonly code = "invalid_workmap";
  constructor() {
    super("invalid workmap");
    this.name = "InvalidWorkMapError";
  }
}

/** The processes tables are missing (migration not applied). The API answers 503, the UI falls back to sessions. */
export class ProcessesUnavailableError extends Error {
  readonly code = "processes_unavailable";
  constructor() {
    super("processes not available yet");
    this.name = "ProcessesUnavailableError";
  }
}

/** sessions.teach is missing (migration not applied). The API answers 503, the Teach page keeps going quietly. */
export class TeachUnavailableError extends Error {
  readonly code = "teach_unavailable";
  constructor() {
    super("teach progress not available yet");
    this.name = "TeachUnavailableError";
  }
}

export function isValidProcessId(id: unknown): id is string {
  return isValidAgentId(id);
}

/** The row values a ProcessPatch writes, shared by both backends. A new workmap bumps the version. */
export function processPatchValues(
  cur: Pick<Process, "version" | "archived_at">,
  patch: ProcessPatch,
  now: string,
): Partial<Pick<Process, "title" | "workmap" | "version" | "confirmed" | "archived_at" | "updated_at">> {
  return {
    ...(patch.title !== undefined ? { title: patch.title } : {}),
    ...(patch.workmap !== undefined
      ? { workmap: patch.workmap, version: cur.version + 1, confirmed: patch.workmap.confirmed_by_expert === true }
      : {}),
    ...(patch.archived !== undefined ? { archived_at: patch.archived ? (cur.archived_at ?? now) : null } : {}),
    updated_at: now,
  };
}

/** Version and process ordering shared by both backends: newest first, id as the tie-break. */
export const processNewestFirst = (a: Process, b: Process) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id);

// Agent ids are UUIDs in both backends (gen_random_uuid in the DB, randomUUID in the file backend).
const AGENT_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isValidAgentId(id: unknown): id is string {
  return typeof id === "string" && AGENT_ID_RE.test(id);
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

export function assertId(id: string): void {
  if (typeof id !== "string" || !ID_RE.test(id)) throw new InvalidSessionIdError(String(id));
}

export function assertFrameName(name: string): void {
  if (!FRAME_RE.test(name)) throw new Error(`invalid frame name: ${JSON.stringify(name)}`);
}

export function frameName(t: number): string {
  return `${String(Math.floor(t)).padStart(4, "0")}.jpg`;
}

export function assertRange(range: { from: number; to?: number }): void {
  if (range.to !== undefined && range.to < range.from) throw new InvalidOffRecordRangeError(range);
}

/** Inclusive on both ends, like the purge filters (gte from, lte to). */
export const inRange = (t: number, r: OffRecordRange) => t >= r.from && (r.to === undefined || t <= r.to);
export const hasOpenRange = (ranges: OffRecordRange[]) => ranges.some((r) => r.to === undefined);
export const isOffRecord = (ranges: OffRecordRange[], t: number) => ranges.some((r) => inRange(t, r));

/** Keeps the expert's first name readable; everything else goes through the default recognizers. */
export function redactOpts(expert: string | undefined | null, recognizers?: RedactOptions["recognizers"]): RedactOptions {
  const first = expert?.trim().split(/\s+/)[0];
  return { ...(first ? { keepNames: [first] } : {}), ...(recognizers ? { recognizers } : {}) };
}

/**
 * The single redaction filter point for stored text (transcript and QA, both backends): the recognizer groups of
 * the session's agent (agents.settings redact_names_emails / redact_iban_phone). Any missing value means on.
 */
export function recognizersFromSettings(settings: unknown): NonNullable<RedactOptions["recognizers"]> {
  const s = (settings && typeof settings === "object" ? settings : {}) as Record<string, unknown>;
  return { namesEmails: s.redact_names_emails !== false, ibanPhone: s.redact_iban_phone !== false };
}
