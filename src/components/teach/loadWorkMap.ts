// Which Work Map Teach uses: ?session=<id>, else the latest confirmed capture session, else SAMPLE_WORKMAP.
// The picker lists the workspace's confirmed Work Maps; the sample is offered only in local mode or when none exist.
import { SAMPLE_WORKMAP } from "@/lib/teach/sampleWorkMap";
import type { Session, WorkMap } from "@/lib/types";
import { formatZurich } from "@/lib/workmap/view";

export type LoadedMap = { workmap: WorkMap; sessionId: string | null; banner: string };

/** Picker value for the bundled sample map. */
export const SAMPLE_ID = "sample";
export const SAMPLE_LABEL = "Sample (demo)";

export type PickerOption = { id: string; label: string };

type Summary = { id: string; kind: Session["kind"]; has_workmap: boolean };

async function getSession(id: string): Promise<Session | null> {
  const res = await fetch(`/api/session/${encodeURIComponent(id)}`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as Session) : null;
}

const sampleMap = (banner: string): LoadedMap => ({ workmap: SAMPLE_WORKMAP, sessionId: null, banner });

export async function loadWorkMap(sessionId: string | null): Promise<LoadedMap> {
  if (sessionId === SAMPLE_ID) return sampleMap("Sample Work Map (demo).");
  try {
    if (sessionId) {
      const s = await getSession(sessionId);
      if (s?.workmap) return { workmap: s.workmap, sessionId: s.id, banner: `Work Map from session ${s.id}.` };
    }
    const res = await fetch("/api/session", { cache: "no-store" });
    const { sessions = [] } = res.ok ? ((await res.json()) as { sessions?: Summary[] }) : {};
    for (const sum of sessions.filter((x) => x.kind === "capture" && x.has_workmap)) {
      const s = await getSession(sum.id);
      if (s?.workmap?.confirmed_by_expert) {
        const note = sessionId ? `Session ${sessionId} has no Work Map. ` : "";
        return { workmap: s.workmap, sessionId: s.id, banner: `${note}Latest confirmed session ${s.id}.` };
      }
    }
  } catch {
    // fall through to the sample
  }
  const note = sessionId ? `Session ${sessionId} has no Work Map. ` : "";
  return sampleMap(`${note}No confirmed session found: using the sample Work Map (demo backup).`);
}

/** Confirmed capture Work Maps, newest first, then the sample in local mode or when there are none. */
export function pickerOptions(sessions: Session[], localMode: boolean): PickerOption[] {
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

/** Reads the workspace's sessions and builds the picker options. */
export async function loadPickerOptions(localMode: boolean): Promise<PickerOption[]> {
  let full: Session[] = [];
  try {
    const res = await fetch("/api/session", { cache: "no-store" });
    const { sessions = [] } = res.ok ? ((await res.json()) as { sessions?: Summary[] }) : {};
    const loaded = await Promise.all(sessions.filter((x) => x.kind === "capture" && x.has_workmap).map((x) => getSession(x.id)));
    full = loaded.filter((s): s is Session => s !== null);
  } catch {
    // no workspace maps: the sample is offered
  }
  return pickerOptions(full, localMode);
}
