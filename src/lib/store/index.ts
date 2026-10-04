// Session store entry point. getStore picks the backend from appMode(); server only.
import { appMode } from "@/lib/supabase/env";
import { fileStore } from "./file";
import { createSupabaseStore } from "./supabase";
import type { SessionStore, StoreContext } from "./types";

export {
  AgentNotFoundError,
  frameName,
  InvalidOffRecordRangeError,
  InvalidWorkMapError,
  InvalidSessionIdError,
  isValidAgentId,
  isValidFrameName,
  isValidSessionId,
  ProcessesUnavailableError,
  ProcessExistsError,
  ProcessNotFoundError,
  ProcessVersionConflictError,
  PROCESS_CHANGE_KINDS,
  PROCESS_TITLE_MAX,
  SessionNotFoundError,
} from "./types";
export type { SessionDigest } from "@/lib/types";
export type { Process, ProcessChangeKind, ProcessInput, ProcessPatch, ProcessVersion, ListProcessesOptions } from "./types";
export type { AgentInput, AgentPatch, OffRecordRange, SaveFrameResult, SessionStore, SessionSummary, StoreContext } from "./types";
export { dataDir, fileStore, framePath } from "./file";
export { createSupabaseStore } from "./supabase";

export function getStore(ctx?: StoreContext): SessionStore {
  const mode = appMode();
  if (mode === "local") return fileStore;
  if (mode === "misconfigured") throw new Error("supabase_not_configured");
  if (!ctx || !ctx.supabase) throw new Error("store_context_required");
  return createSupabaseStore(ctx.supabase, ctx);
}
