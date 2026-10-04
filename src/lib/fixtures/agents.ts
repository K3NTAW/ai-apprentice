// Agents home fixture (design compare, docs/design/compare/agents-*.png): the five Gallery.dc.html agents.
// Pip learns from Sabine Keller and has a confirmed Work Map; Nova is still training (draft map only).
import type { Agent, Session, WorkMap } from "@/lib/types";

const base = { events: [], transcript: [], qa: [], off_record_ranges: [] };

const agent = (id: string, name: string, role: string, expert: string, avatar: Agent["avatar"]): Agent => ({
  id,
  workspace_id: "local",
  name,
  role,
  expert_name: expert,
  avatar,
  created_at: "2026-09-01T08:00:00Z",
  updated_at: "2026-09-01T08:00:00Z",
});

export const previewAgents: Agent[] = [
  agent("pip", "Pip", "Senior AP Clerk", "Sabine Keller", { shape: "blob", face: "smile", color: "#ECEAE5", accent: "#3A4EFD" }),
  agent("juno", "Juno", "Senior Sales Person", "Marco Bianchi", { shape: "bean", face: "wink", color: "#F3A150", accent: "#62A9F3" }),
  agent("otto", "Otto", "Plant Controller", "Urs Gerber", { shape: "square", face: "focus", color: "#65D9A5", accent: "#A27DF8" }),
  agent("nova", "Nova", "Payroll Specialist", "Brigitte Roth", { shape: "round", face: "calm", color: "#A27DF8", accent: "#E775C0" }),
  agent("bolt", "Bolt", "IT Service Desk Lead", "Reto Frei", { shape: "pill", face: "robot", color: "#F3C354", accent: "#3A4EFD" }),
];

const step = (n: number, title: string, rules: string[]) => ({
  n,
  title,
  screen_moment: { t: n * 40, entity: title },
  decision: title,
  is_judgment_call: false,
  reason: null,
  guardrails: rules.map((rule) => ({ rule, quote_ref: 0, kind: "limit" as const })),
  scores: { reason_captured: 1, guardrail_captured: 1 },
});

const map = (task: string, expert: string, confirmed: boolean, rules: string[]): WorkMap =>
  ({
    task,
    expert,
    confirmed_by_expert: confirmed,
    open_questions: [],
    steps: rules.map((r, i) => step(i + 1, `${task}, step ${i + 1}`, [r])),
  }) as WorkMap;

const capture = (id: string, agentId: string, at: string, wm: WorkMap): Session => ({ ...base, id, kind: "capture", agent_id: agentId, started_at: at, ended_at: at, workmap: wm });

const teach = (id: string, agentId: string, mapId: string, by: string): Session & { created_by: string } => ({
  ...base,
  id,
  kind: "teach",
  agent_id: agentId,
  started_at: "2026-10-03T09:00:00Z",
  teach: { workmap_session_id: mapId, mastered: [], practice: [], interventions: 0, finished_at: "2026-10-03T09:20:00Z" },
  created_by: by,
});

const rules = (prefix: string, n: number) => Array.from({ length: n }, (_, i) => `${prefix} rule ${i + 1}`);

export const previewSessions: Session[] = [
  capture("pip-1", "pip", "2026-10-02T12:00:00Z", map("Code incoming supplier invoices", "Sabine Keller", true, rules("Capex over €5,000", 4))),
  capture("pip-2", "pip", "2026-09-30T12:00:00Z", map("Release a payment run", "Sabine Keller", true, rules("Second approval", 3))),
  capture("juno-1", "juno", "2026-09-27T12:00:00Z", map("Send a quote", "Marco Bianchi", true, rules("Discount", 3))),
  capture("otto-1", "otto", "2026-09-21T12:00:00Z", map("Close the month", "Urs Gerber", true, rules("Accrual", 2))),
  capture("nova-1", "nova", "2026-10-04T12:05:00Z", map("Run payroll", "Brigitte Roth", false, rules("Bonus", 2))),
  capture("bolt-1", "bolt", "2026-09-15T12:00:00Z", map("Reset a password", "Reto Frei", true, rules("Identity check", 2))),
  teach("t-1", "pip", "pip-1", "learner-1"),
  teach("t-2", "pip", "pip-1", "learner-2"),
  teach("t-3", "pip", "pip-2", "learner-3"),
  teach("t-4", "juno", "juno-1", "learner-1"),
  teach("t-5", "bolt", "bolt-1", "learner-2"),
];
