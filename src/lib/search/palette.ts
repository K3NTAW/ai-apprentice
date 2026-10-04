// Pure builder for GET /api/search (the ⌘K command palette): agents, Work Maps (title and step titles), guardrails and
// recent sessions of one workspace, matched case-insensitively on every word of the query. The route passes only
// rows read through the workspace-scoped store, so nothing here filters by workspace.
import type { Agent, SessionDigest } from "@/lib/types";

export const SEARCH_QUERY_MAX = 100;
export const SEARCH_GROUP_LIMIT = 5;

export type SearchHit = { id: string; title: string; detail: string; href: string };
export type SearchResponse = { agents: SearchHit[]; workmaps: SearchHit[]; guardrails: SearchHit[]; sessions: SearchHit[] };

const words = (q: string) => q.toLowerCase().split(/\s+/).filter(Boolean);
const matches = (ws: string[], ...texts: (string | undefined | null)[]) => {
  const hay = texts.filter(Boolean).join(" ").toLowerCase();
  return ws.every((w) => hay.includes(w));
};
const enc = encodeURIComponent;
const newestFirst = (a: SessionDigest, b: SessionDigest) => Date.parse(b.started_at) - Date.parse(a.started_at) || b.id.localeCompare(a.id);

/** Where a session opens: teach its summary, a capture its Work Map once there is one, else its debrief. */
export const sessionHref = (s: { id: string; kind: "capture" | "teach"; has_workmap: boolean }) =>
  s.kind === "teach" ? `/teach?session=${enc(s.id)}` : s.has_workmap ? `/map/${enc(s.id)}` : `/debrief/${enc(s.id)}`;

export function searchPalette(query: string, agents: readonly Agent[], digests: readonly SessionDigest[], limit = SEARCH_GROUP_LIMIT): SearchResponse {
  const ws = words(query);
  const names = new Map(agents.map((a) => [a.id, a.name]));
  const sorted = [...digests].sort(newestFirst);
  const maps = sorted.filter((s) => s.kind === "capture" && s.workmap);

  const agentHits = agents
    .filter((a) => matches(ws, a.name, a.role, a.expert_name))
    .slice(0, limit)
    .map((a) => ({ id: a.id, title: a.name, detail: a.role, href: `/agents/${enc(a.id)}` }));

  const workmapHits: SearchHit[] = [];
  const guardrailHits: SearchHit[] = [];
  for (const s of maps) {
    const wm = s.workmap!;
    if (workmapHits.length < limit) {
      const step = ws.length ? wm.steps.find((st) => matches(ws, st.title)) : undefined;
      if (matches(ws, wm.task)) workmapHits.push({ id: s.id, title: wm.task, detail: `${wm.steps.length} steps${wm.confirmed_by_expert ? " · confirmed" : ""}`, href: `/map/${enc(s.id)}` });
      else if (step) workmapHits.push({ id: `${s.id}#${step.n}`, title: wm.task, detail: `Step ${step.n} · ${step.title}`, href: `/map/${enc(s.id)}#step-${step.n}` });
    }
    for (const st of wm.steps) {
      for (const [i, g] of st.guardrails.entries()) {
        if (guardrailHits.length < limit && matches(ws, g.rule)) {
          guardrailHits.push({ id: `${s.id}#${st.n}.${i}`, title: g.rule, detail: `${wm.task} · step ${st.n}`, href: `/map/${enc(s.id)}#step-${st.n}` });
        }
      }
    }
  }

  const sessionHits = sorted
    .filter((s) => matches(ws, s.workmap?.task, s.expert, s.agent_id ? names.get(s.agent_id) : undefined, s.kind === "teach" ? "teach learns" : "capture training debrief"))
    .slice(0, limit)
    .map((s) => {
      const agent = s.agent_id ? names.get(s.agent_id) : undefined;
      const topic = s.workmap?.task ?? agent ?? s.expert ?? (s.kind === "teach" ? "Teach" : "Capture");
      return {
        id: s.id,
        title: s.kind === "teach" ? `Teach · ${topic}` : `${s.workmap ? "Work Map" : "Capture"} · ${topic}`,
        detail: s.started_at.slice(0, 10),
        href: sessionHref({ id: s.id, kind: s.kind, has_workmap: !!s.workmap }),
      };
    });

  return { agents: agentHits, workmaps: workmapHits, guardrails: guardrailHits, sessions: sessionHits };
}
