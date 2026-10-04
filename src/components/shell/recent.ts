// Recent sessions for the sidebar. Not in the canvas data model: Sidebar.dc.html shows a static list, the app fills it
// from the store (latest capture and teach sessions of the request-context workspace), grouped Today/Yesterday/Earlier
// in Europe/Zurich.
import type { SessionSummary } from "@/lib/store/types";

export const RECENT_LIMIT = 6;
const TZ = "Europe/Zurich";

export type RecentItem = { id: string; title: string; meta: string; href: string; live: boolean };
export type RecentGroup = { label: "Today" | "Yesterday" | "Earlier"; items: RecentItem[] };
/** ok with groups (possibly empty), or error when the store could not be read. */
export type RecentSessions = { kind: "ok"; groups: RecentGroup[] } | { kind: "error" };

const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const time = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

export function groupRecent(sessions: SessionSummary[], now: Date, limit = RECENT_LIMIT): RecentGroup[] {
  const today = day(now);
  const yesterday = day(new Date(now.getTime() - 86_400_000));
  const latest = sessions
    .filter((s) => s.kind === "capture" || s.kind === "teach")
    .filter((s) => !Number.isNaN(Date.parse(s.started_at)))
    .sort((a, b) => Date.parse(b.started_at) - Date.parse(a.started_at))
    .slice(0, limit);
  const groups: RecentGroup[] = [];
  for (const s of latest) {
    const started = new Date(s.started_at);
    const d = day(started);
    const label = d === today ? "Today" : d === yesterday ? "Yesterday" : "Earlier";
    const live = !s.ended_at;
    const what = s.kind === "teach" ? "Teach" : s.has_workmap ? "Work Map" : "Capture";
    const title = s.expert ? `${what} · ${s.expert}` : what;
    const when = label === "Earlier" ? d : time(started);
    const item: RecentItem = {
      id: s.id,
      title,
      meta: live ? `live · ${when}` : when,
      // Teach opens its summary; a capture its Work Map once there is one, else its debrief.
      href: s.kind === "teach" ? `/teach?session=${encodeURIComponent(s.id)}` : s.has_workmap ? `/map/${encodeURIComponent(s.id)}` : `/debrief/${encodeURIComponent(s.id)}`,
      live,
    };
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
