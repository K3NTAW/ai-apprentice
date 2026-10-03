// Which Work Map Teach uses: ?session=<id>, else the latest confirmed capture session, else SAMPLE_WORKMAP.
import { SAMPLE_WORKMAP } from "@/lib/teach/sampleWorkMap";
import type { Session, WorkMap } from "@/lib/types";

export type LoadedMap = { workmap: WorkMap; sessionId: string | null; banner: string };

type Summary = { id: string; kind: Session["kind"]; has_workmap: boolean };

async function getSession(id: string): Promise<Session | null> {
  const res = await fetch(`/api/session/${encodeURIComponent(id)}`, { cache: "no-store" });
  return res.ok ? ((await res.json()) as Session) : null;
}

export async function loadWorkMap(sessionId: string | null): Promise<LoadedMap> {
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
  return { workmap: SAMPLE_WORKMAP, sessionId: null, banner: `${note}No confirmed session found: using the sample Work Map (demo backup).` };
}
