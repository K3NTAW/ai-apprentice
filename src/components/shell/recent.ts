// Recent sessions for the sidebar, in the Sidebar.dc.html formats. The app fills the list from the store (latest capture
// and teach sessions of the request-context workspace), grouped Today/Yesterday/Earlier in Europe/Zurich.
// Titles: 'Training Pip · supplier invoices' (capture running), 'Work Map · duplicate check' (capture with a map),
// 'Debrief · Czech approvals' (capture ended, no map yet), 'Lena learns supplier invoices' (teach with a learner),
// else '<agent> · <topic>'. Second line: live elapsed time, 'x of y mastered', 'confirmed', '<agent> · 14:05' or the date.
import { sessionHref } from "@/lib/search/palette";
import type { SessionSummary } from "@/lib/store/types";

export const RECENT_LIMIT = 6;
const TZ = "Europe/Zurich";

export type RecentItem = { id: string; title: string; meta: string; href: string; live: boolean };
export type RecentGroup = { label: "Today" | "Yesterday" | "Earlier"; items: RecentItem[] };
/** ok with groups (possibly empty), or error when the store could not be read. */
export type RecentSessions = { kind: "ok"; groups: RecentGroup[] } | { kind: "error" };
/** Agent names by id, for the titles. */
export type AgentNames = Readonly<Record<string, string>>;

const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const time = (d: Date) => new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);

/** '4 min', '1 h 05 min'; never negative. */
export function elapsed(from: Date, now: Date): string {
  const min = Math.max(0, Math.floor((now.getTime() - from.getTime()) / 60_000));
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${String(min % 60).padStart(2, "0")} min`;
}

function title(s: SessionSummary, agent: string | undefined, live: boolean): string {
  const topic = s.task;
  const join = (a: string | undefined, b: string | undefined) => [a, b].filter(Boolean).join(" · ");
  if (s.kind === "teach") {
    if (s.expert && topic) return `${s.expert} learns ${topic}`;
    return join(agent ?? s.expert, topic) || "Teach";
  }
  if (live) return agent ? `Training ${join(agent, topic)}` : join("Training", topic ?? s.expert);
  if (s.has_workmap) return join("Work Map", topic ?? agent);
  return join("Debrief", topic ?? agent ?? s.expert);
}

function meta(s: SessionSummary, agent: string | undefined, started: Date, label: RecentGroup["label"], live: boolean, now: Date): string {
  if (live) return `live · ${elapsed(started, now)}`;
  if (s.kind === "teach" && s.mastered !== undefined && s.practiced) return `${s.mastered} of ${s.practiced} mastered`;
  if (s.confirmed) return "confirmed";
  if (label === "Earlier") return day(started);
  return agent ? `${agent} · ${time(started)}` : time(started);
}

export function groupRecent(sessions: SessionSummary[], now: Date, agents: AgentNames = {}, limit = RECENT_LIMIT): RecentGroup[] {
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
    const agent = s.agent_id ? agents[s.agent_id] : undefined;
    const item: RecentItem = { id: s.id, title: title(s, agent, live), meta: meta(s, agent, started, label, live, now), href: sessionHref(s), live };
    const last = groups[groups.length - 1];
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}
