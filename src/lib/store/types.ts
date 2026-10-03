// Store contract shared by the file and supabase backends. Leaf module: imports nothing from ./index, ./file or ./supabase.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { RedactOptions } from "@/lib/redact";
import type { QAPair, ScreenEvent, Session, TranscriptEntry, WorkMap } from "@/lib/types";

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

export type SaveFrameResult = { stored: true; name: string } | { stored: false; reason: "off_record" };

export interface SessionStore {
  createSession(input: { kind: Session["kind"]; expert?: string }): Promise<Session>;
  getSession(id: string): Promise<Session | null>;
  listSessions(): Promise<SessionSummary[]>;
  appendEvents(id: string, events: ScreenEvent[]): Promise<Session>;
  appendTranscript(id: string, entries: TranscriptEntry[]): Promise<Session>;
  upsertQA(id: string, qa: QAPair): Promise<Session>;
  setOffRecord(id: string, range: { from: number; to?: number }): Promise<Session>;
  saveWorkMap(id: string, workmap: WorkMap): Promise<Session>;
  endSession(id: string): Promise<Session>;
  saveFrame(id: string, t: number, data: Buffer): Promise<SaveFrameResult>;
  readFrame(id: string, name: string): Promise<Buffer | null>;
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
