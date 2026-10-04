// Which Work Map Teach uses: ?process=<id> (the process's current Work Map, edits included, taught through
// ?session), else ?session=<id>, else the latest confirmed capture session, else SAMPLE_WORKMAP.
// The picker lists the workspace's confirmed Work Maps; the sample is offered only in local mode or when none exist.
// Each loader is one GET /api/workmaps. A non-ok answer (401, 403, 5xx) throws WorkMapLoadError: no silent sample.
import { SAMPLE_WORKMAP } from "@/lib/teach/sampleWorkMap";
import type { Session, WorkMap } from "@/lib/types";
import { WORKMAPS_MAX_LIMIT, type WorkMapsResponse } from "@/lib/workmap/items";
import { formatZurich } from "@/lib/workmap/view";

export type LoadedMap = { workmap: WorkMap; sessionId: string | null; banner: string };

/** Picker value for the bundled sample map. */
export const SAMPLE_ID = "sample";
export const SAMPLE_LABEL = "Sample (demo)";

export type PickerOption = { id: string; label: string };

/** Anything with a Work Map the picker can list: a Session or a /api/workmaps item. */
export type PickerSource = Pick<Session, "id" | "kind" | "started_at"> & { expert?: string | null; workmap?: WorkMap };

export class WorkMapLoadError extends Error {
  constructor(readonly status: number) {
    super(`GET /api/workmaps ${status}`);
    this.name = "WorkMapLoadError";
  }
}

async function fetchWorkMaps(params: Record<string, string>): Promise<WorkMapsResponse> {
  const res = await fetch(`/api/workmaps?${new URLSearchParams(params)}`, { cache: "no-store" });
  if (!res.ok) throw new WorkMapLoadError(res.status);
  return (await res.json()) as WorkMapsResponse;
}

const sampleMap = (banner: string): LoadedMap => ({ workmap: SAMPLE_WORKMAP, sessionId: null, banner });

type ProcessAnswer = { title: string; workmap: WorkMap; confirmed: boolean; archived_at: string | null; version: number };

/** GET /api/processes/<id>: the process's current Work Map, or null (missing, archived, unconfirmed, 503). */
async function loadProcessMap(processId: string, sessionId: string): Promise<LoadedMap | null> {
  const res = await fetch(`/api/processes/${encodeURIComponent(processId)}`, { cache: "no-store" });
  if (res.status === 401 || res.status === 403) throw new WorkMapLoadError(res.status);
  if (!res.ok) return null;
  const p = (await res.json()) as ProcessAnswer;
  if (!p.confirmed || p.archived_at) return null;
  return { workmap: { ...p.workmap, task: p.title }, sessionId, banner: `Process "${p.title}", version ${p.version}.` };
}

/**
 * processId (with a session): the process's current Work Map, falling back to the session's map when the process
 * cannot be read. Otherwise one request: ?session_id returns the named map (confirmed or not) next to the latest
 * confirmed one.
 */
export async function loadWorkMap(sessionId: string | null, processId: string | null = null): Promise<LoadedMap> {
  if (sessionId === SAMPLE_ID) return sampleMap("Sample Work Map (demo).");
  if (processId && sessionId) {
    const fromProcess = await loadProcessMap(processId, sessionId);
    if (fromProcess) return fromProcess;
  }
  const { maps, session } = await fetchWorkMaps({ confirmed: "1", limit: "1", ...(sessionId ? { session_id: sessionId } : {}) });
  if (session) return { workmap: session.workmap, sessionId: session.id, banner: `Work Map from session ${session.id}.` };
  const note = sessionId ? `Session ${sessionId} has no Work Map. ` : "";
  const latest = maps[0];
  if (latest) return { workmap: latest.workmap, sessionId: latest.id, banner: `${note}Latest confirmed session ${latest.id}.` };
  return sampleMap(`${note}No confirmed session found: using the sample Work Map (demo backup).`);
}

/** Confirmed capture Work Maps, newest first, then the sample in local mode or when there are none. */
export function pickerOptions(sessions: readonly PickerSource[], localMode: boolean): PickerOption[] {
  const confirmed = sessions
    .filter((s) => s.kind === "capture" && s.workmap?.confirmed_by_expert === true)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .map((s) => ({ id: s.id, label: `${s.workmap!.expert || s.expert || "unknown"} · ${formatZurich(s.started_at)} · ${s.workmap!.task}` }));
  return localMode || confirmed.length === 0 ? [...confirmed, { id: SAMPLE_ID, label: SAMPLE_LABEL }] : confirmed;
}

/** ?session=<id> when the picker offers it, else the first option. */
export function preselect(options: PickerOption[], sessionId: string | null): string | null {
  if (sessionId && options.some((o) => o.id === sessionId)) return sessionId;
  return options[0]?.id ?? null;
}

/** The workspace's confirmed maps in one request, as picker options. Throws WorkMapLoadError on a non-ok answer. */
export async function loadPickerOptions(localMode: boolean): Promise<PickerOption[]> {
  const { maps } = await fetchWorkMaps({ confirmed: "1", limit: String(WORKMAPS_MAX_LIMIT) });
  return pickerOptions(maps, localMode);
}
