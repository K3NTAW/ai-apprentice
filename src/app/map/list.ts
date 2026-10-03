// Pure row builder for the Work Map list (/map): capture sessions with a Work Map, newest first.
import type { Session } from "@/lib/types";
import { countsLine, formatZurich } from "@/lib/workmap/view";

export type MapListRow = {
  id: string;
  expert: string;
  /** "YYYY-MM-DD HH:mm", Europe/Zurich, 24 h. */
  date: string;
  confirmed: boolean;
  counts: string;
  href: string;
};

export function mapListRows(sessions: Session[]): MapListRow[] {
  return sessions
    .filter((s): s is Session & { workmap: NonNullable<Session["workmap"]> } => s.kind === "capture" && !!s.workmap)
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .map((s) => ({
      id: s.id,
      expert: s.workmap.expert || s.expert || "unknown",
      date: formatZurich(s.started_at),
      confirmed: s.workmap.confirmed_by_expert === true,
      counts: countsLine(s.workmap),
      href: `/map/${encodeURIComponent(s.id)}`,
    }));
}
