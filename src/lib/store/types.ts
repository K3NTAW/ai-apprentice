// Store contract shared by the file and supabase backends. Leaf module: imports nothing from ./index, ./file or ./supabase.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RedactOptions } from "@/lib/redact";
import type { Agent, Avatar, QAPair, ScreenEvent, Session, SessionDigest, TranscriptEntry, WorkMap } from "@/lib/types";

export type SessionSummary = {
  id: string;
  kind: Session["kind"];
  started_at: string;
  ended_at?: string;
  expert?: string;
  counts: { events: number; transcript: number; qa: number };
  has_workmap: boolean;
  agent_id?: string;
};

export const RECENT_SESSIONS_DEFAULT = 6;

export type AgentInput = { name: string; role: string; expert_name?: string; avatar: Avatar };
/** PATCH semantics: given keys replace the stored value (avatar as a whole); expert_name null clears it. */
export type AgentPatch = { name?: string; role?: string; expert_name?: string | null; avatar?: Avatar };

export type OffRecordRange = Session["off_record_ranges"][number];

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
  saveFrame(id: string, t: number, data: Buffer): Promise<SaveFrameResult>;
  readFrame(id: string, name: string): Promise<Buffer | null>;
  /** Newest first. */
  listAgents(): Promise<Agent[]>;
  /** null for a missing agent, an agent of another workspace and a malformed id alike. */
  getAgent(id: string): Promise<Agent | null>;
  createAgent(input: AgentInput): Promise<Agent>;
  /** Throws AgentNotFoundError when missing or outside the workspace. */
  updateAgent(id: string, patch: AgentPatch): Promise<Agent>;
  /** False when missing or outside the workspace. Sessions keep their history; their agent_id is cleared. */
  deleteAgent(id: string): Promise<boolean>;
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
export function redactOpts(expert: string | undefined | null): RedactOptions {
  const first = expert?.trim().split(/\s+/)[0];
  return first ? { keepNames: [first] } : {};
}
