// Test fixtures for the agent view models (not imported by app code).
import type { Agent, Session, WorkMap } from "@/lib/types";

const base = { events: [], transcript: [], qa: [], off_record_ranges: [] };
const avatar = { shape: "blob", face: "smile", color: "#F4A261", accent: "#2A9D8F" } as const;

export const AGENT_A: Agent = {
  id: "agent-a",
  workspace_id: "ws",
  name: "Senior Sales Person",
  role: "Prepares and sends quotes",
  expert_name: "Sabine",
  avatar,
  created_at: "2026-10-03T20:00:00Z",
  updated_at: "2026-10-03T20:00:00Z",
};
export const AGENT_B: Agent = { ...AGENT_A, id: "agent-b", name: "AP Clerk", role: "Codes invoices", expert_name: undefined };

const map = (task: string, extra: Record<string, unknown> = {}): WorkMap =>
  ({
    task,
    expert: "Sabine",
    confirmed_by_expert: true,
    open_questions: [],
    steps: [
      {
        n: 1,
        title: "Open the quote template",
        screen_moment: { t: 12, entity: "template" },
        decision: "pick template",
        is_judgment_call: false,
        reason: null,
        guardrails: [{ rule: "Never discount above 15%", quote_ref: 0, kind: "limit", quote: "Above 15% I ask my boss." }],
        scores: { reason_captured: 1, guardrail_captured: 1 },
        ...extra,
      },
      {
        n: 2,
        title: "Send",
        screen_moment: { t: 75, entity: "send" },
        decision: "send",
        is_judgment_call: false,
        reason: null,
        guardrails: [],
        scores: { reason_captured: 1, guardrail_captured: 1 },
      },
    ],
  }) as WorkMap;

export const SESSIONS: Session[] = [
  {
    ...base,
    id: "cap-1",
    kind: "capture",
    agent_id: "agent-a",
    started_at: "2026-10-03T19:00:00Z",
    workmap: map("Send a quote", {
      shortcuts: [
        { chord: "Cmd+Shift+T", app: "Microsoft Outlook", what: "Insert the quote template", why: "Saves retyping the terms." },
        { chord: "", app: "bad" },
        "junk",
      ],
    }),
  },
  { ...base, id: "cap-2", kind: "capture", agent_id: "agent-a", started_at: "2026-10-03T20:00:00Z", workmap: { ...map("Draft"), confirmed_by_expert: false } },
  { ...base, id: "cap-3", kind: "capture", agent_id: "agent-b", started_at: "2026-10-03T20:00:00Z" },
  {
    ...base,
    id: "t-old",
    kind: "teach",
    agent_id: "agent-a",
    started_at: "2026-10-03T21:00:00Z",
    teach: { workmap_session_id: "cap-1", mastered: [], practice: ["1"], interventions: 3, finished_at: "2026-10-03T21:10:00Z" },
  },
  {
    ...base,
    id: "t-new",
    kind: "teach",
    agent_id: "agent-a",
    started_at: "2026-10-03T22:00:00Z",
    teach: { workmap_session_id: "cap-1", mastered: ["1"], practice: [], interventions: 1, finished_at: "2026-10-03T22:15:00Z" },
  },
];
export const MEMBERS = [{ userId: "u-anna-123456", label: "anna@example.com", role: "learner" }];
export const CREATED_BY = { "t-old": "u-anna-123456", "t-new": "u-anna-123456" };
