// Session store entry point. getStore picks the backend from appMode(); server only.
import { appMode } from "@/lib/supabase/env";
import type { QAPair, ScreenEvent, Session, TranscriptEntry, WorkMap } from "@/lib/types";
import { fileStore } from "./file";
import { createSupabaseStore } from "./supabase";
import type { SaveFrameResult, SessionStore, SessionSummary, StoreContext } from "./types";

export {
  frameName,
  InvalidOffRecordRangeError,
  InvalidSessionIdError,
  isValidFrameName,
  isValidSessionId,
  SessionNotFoundError,
} from "./types";
export type { OffRecordRange, SaveFrameResult, SessionStore, SessionSummary, StoreContext } from "./types";
export { dataDir, fileStore, framePath } from "./file";
export { createSupabaseStore } from "./supabase";

export function getStore(ctx?: StoreContext): SessionStore {
  const mode = appMode();
  if (mode === "local") return fileStore;
  if (mode === "misconfigured") throw new Error("supabase_not_configured");
  if (!ctx || !ctx.supabase) throw new Error("store_context_required");
  return createSupabaseStore(ctx.supabase, ctx);
}

// Top-level wrappers over fileStore so existing routes keep compiling until Launch D moves them to getStore(ctx).
// Known interim state: between this task and Launch D the routes fail loudly in supabase mode
// (file_store_not_allowed) and never write to the local filesystem.
// Async so the guard rejects instead of throwing synchronously; the fileStore call still starts synchronously.
function assertLocal(): void {
  if (appMode() !== "local") throw new Error("file_store_not_allowed");
}

export async function createSession(input: { kind: Session["kind"]; expert?: string }): Promise<Session> {
  assertLocal();
  return fileStore.createSession(input);
}

export async function getSession(id: string): Promise<Session | null> {
  assertLocal();
  return fileStore.getSession(id);
}

export async function listSessions(): Promise<SessionSummary[]> {
  assertLocal();
  return fileStore.listSessions();
}

export async function appendEvents(id: string, events: ScreenEvent[]): Promise<Session> {
  assertLocal();
  return fileStore.appendEvents(id, events);
}

export async function appendTranscript(id: string, entries: TranscriptEntry[]): Promise<Session> {
  assertLocal();
  return fileStore.appendTranscript(id, entries);
}

export async function upsertQA(id: string, qa: QAPair): Promise<Session> {
  assertLocal();
  return fileStore.upsertQA(id, qa);
}

/**
 * Opens a range ({from}) or closes one ({from, to}). Data already stored inside a closed range is purged.
 * Rejects with InvalidOffRecordRangeError when to < from; stored ranges stay untouched.
 */
export async function setOffRecord(id: string, range: { from: number; to?: number }): Promise<Session> {
  assertLocal();
  return fileStore.setOffRecord(id, range);
}

export async function saveWorkMap(id: string, workmap: WorkMap): Promise<Session> {
  assertLocal();
  return fileStore.saveWorkMap(id, workmap);
}

export async function endSession(id: string): Promise<Session> {
  assertLocal();
  return fileStore.endSession(id);
}

/**
 * Writes one frame captured at t and records {name, t} on the session so off-record purges can find it.
 * Skips the write when t is inside an off-record range or a range is open.
 */
export async function saveFrame(id: string, t: number, data: Buffer): Promise<SaveFrameResult> {
  assertLocal();
  return fileStore.saveFrame(id, t, data);
}

export async function readFrame(id: string, name: string): Promise<Buffer | null> {
  assertLocal();
  return fileStore.readFrame(id, name);
}
