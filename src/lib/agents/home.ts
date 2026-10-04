// Agents home input box (Gallery.dc.html): 'Ask how something is done, or start a session'. Pure, no I/O.
//
// Data source: the server page (/agents) builds a compact index from the sessions it already loads
// (loadAgentsInput), and passes it to the client component, which searches it as the user types.
// Rules (amendment A2/A3):
// - Only confirmed Work Maps (confirmed_by_expert) of the workspace's agents are indexed; drafts never show.
// - A query is split into words of 2+ characters; a step matches when every word appears (case-insensitive)
//   in its task, title, decision, reason or one of its guardrail rules. At most HOME_RESULT_CAP results.
// - Empty query: no results and no message. No match: NO_MATCH_TEXT.
// - 'start a session' (or 'start session', 'start') starts Capture for the selected agent: /capture?agent=<id>.
//   The selected agent defaults to the first gallery card; with no agents or a viewer role (canCreate false)
//   there is no Start action.
import type { Agent, Guardrail, Session } from "@/lib/types";

export const HOME_PLACEHOLDER = "Ask how something is done, or start a session";
export const HOME_LABEL = "Ask an agent or start a session";
export const HOME_RESULT_CAP = 8;
export const NO_MATCH_TEXT = "No confirmed Work Map step matches that yet.";

export type HomeEntry = {
  agentId: string;
  agentName: string;
  task: string;
  step: string;
  text: string;
  guardrails: { rule: string; kind: Guardrail["kind"] }[];
  href: string;
};

export function homeIndex(agents: readonly Pick<Agent, "id" | "name">[], sessions: readonly Session[]): HomeEntry[] {
  const names = new Map(agents.map((a) => [a.id, a.name]));
  return sessions.flatMap((s) => {
    const wm = s.workmap;
    if (s.kind !== "capture" || !wm?.confirmed_by_expert || !s.agent_id || !names.has(s.agent_id)) return [];
    const task = wm.task || "Untitled capture";
    return wm.steps.map((step) => ({
      agentId: s.agent_id!,
      agentName: names.get(s.agent_id!)!,
      task,
      step: `${step.n}. ${step.title}`,
      text: [task, step.title, step.decision, step.reason ?? "", ...step.guardrails.map((g) => g.rule)].join(" ").toLowerCase(),
      guardrails: step.guardrails.map((g) => ({ rule: g.rule, kind: g.kind })),
      href: `/map/${encodeURIComponent(s.id)}#step-${step.n}`,
    }));
  });
}

const words = (q: string) => q.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);

export function searchHome(query: string, index: readonly HomeEntry[]): HomeEntry[] {
  const ws = words(query);
  if (ws.length === 0) return [];
  return index.filter((e) => ws.every((w) => e.text.includes(w))).slice(0, HOME_RESULT_CAP);
}

export const isStartIntent = (q: string) => /^\s*start( a)?( session)?\s*$/i.test(q);

export type HomeAction =
  | { kind: "none" }
  | { kind: "start"; href: string }
  | { kind: "search"; results: HomeEntry[]; message: string | null };

/** What submitting the box does. agentId is the selected agent, or null when Start is not available. */
export function homeAction(query: string, index: readonly HomeEntry[], agentId: string | null): HomeAction {
  if (isStartIntent(query) && agentId) return { kind: "start", href: `/capture?agent=${encodeURIComponent(agentId)}` };
  if (words(query).length === 0) return { kind: "none" };
  const results = searchHome(query, index);
  return { kind: "search", results, message: results.length ? null : NO_MATCH_TEXT };
}

/** 'Good morning' before 12:00, 'Good afternoon' before 18:00, else 'Good evening' (Europe/Zurich). */
export function greeting(now: Date, email: string | null): string {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: "Europe/Zurich" }).format(now));
  const part = hour < 12 ? "morning" : hour < 18 ? "afternoon" : "evening";
  const local = email?.split("@")[0]?.split(/[._+-]/)[0] ?? "";
  const name = /^[a-z]{2,}$/i.test(local) ? local[0].toUpperCase() + local.slice(1).toLowerCase() : "";
  return name ? `Good ${part}, ${name}` : `Good ${part}`;
}
