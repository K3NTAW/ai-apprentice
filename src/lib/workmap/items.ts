// Pure builder for GET /api/workmaps: capture Work Maps from session digests, filtered, newest first, capped.
import type { SessionDigest, WorkMap } from "@/lib/types";

export const WORKMAPS_DEFAULT_LIMIT = 50;
export const WORKMAPS_MAX_LIMIT = 200;

export type WorkMapItem = {
  id: string;
  kind: "capture";
  expert: string | null;
  agent_id: string | null;
  started_at: string;
  ended_at: string | null;
  workmap: WorkMap;
};

/** maps: the filtered list. session: the named session's map whether confirmed or not, null when it has none. */
export type WorkMapsResponse = { maps: WorkMapItem[]; session: WorkMapItem | null };

export type WorkMapsQuery = { confirmed: boolean; agentId: string | null; sessionId: string | null; limit: number };

const item = (s: SessionDigest & { workmap: WorkMap }): WorkMapItem => ({
  id: s.id,
  kind: "capture",
  expert: s.expert ?? null,
  agent_id: s.agent_id ?? null,
  started_at: s.started_at,
  ended_at: s.ended_at ?? null,
  workmap: s.workmap,
});

const newestFirst = (a: SessionDigest, b: SessionDigest) => Date.parse(b.started_at) - Date.parse(a.started_at) || b.id.localeCompare(a.id);

export function workMapItems(digests: readonly SessionDigest[], q: WorkMapsQuery): WorkMapsResponse {
  const withMap = digests.filter((s): s is SessionDigest & { workmap: WorkMap } => !!s.workmap);
  const maps = withMap
    .filter((s) => s.kind === "capture")
    .filter((s) => !q.confirmed || s.workmap.confirmed_by_expert === true)
    .filter((s) => !q.agentId || s.agent_id === q.agentId)
    .sort(newestFirst)
    .slice(0, q.limit)
    .map(item);
  const hit = q.sessionId ? withMap.find((s) => s.id === q.sessionId) : undefined;
  return { maps, session: hit ? item(hit) : null };
}

/** limit from the query string: absent gives the default, anything but an integer in 1..MAX is null (400). */
export function parseLimit(raw: string | null): number | null {
  if (raw === null) return WORKMAPS_DEFAULT_LIMIT;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 1 && n <= WORKMAPS_MAX_LIMIT ? n : null;
}
