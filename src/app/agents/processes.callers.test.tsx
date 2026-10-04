// Callers of agentStats, agentStatus and the agent view models pass the processes from loadAgentsInput, merged with
// legacy confirmed sessions (agentWorkMaps): the gallery cards and filter counts, the agent page header and tabs,
// and Learn. Boundaries mocked: the request context, the loader, the shell and the client views (props captured).
import type { ReactElement } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { filterCards, type GalleryCard, type LearnProcess, type ProcessRow } from "@/components/agents/model";
import type { AgentsInput } from "@/lib/dashboard/agents";
import type { Process } from "@/lib/store/types";
import type { Agent, SessionDigest, WorkMap } from "@/lib/types";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const P = "pppppppp-pppp-4ppp-8ppp-pppppppppppp";

const step = (rule: string, score: number) => ({
  n: 1,
  title: "Check the amount",
  screen_moment: { t: 3, entity: "Invoice" },
  decision: "approve",
  is_judgment_call: true,
  reason: null,
  guardrails: [{ rule, quote_ref: 0, kind: "limit" as const }],
  scores: { reason_captured: score, guardrail_captured: score },
});
const wm = (task: string, confirmed: boolean, rule: string, score: number): WorkMap => ({
  task,
  expert: "Sabine",
  confirmed_by_expert: confirmed,
  steps: [step(rule, score)],
  open_questions: [],
});
const session = (id: string, started_at: string, workmap: WorkMap, process_id?: string) =>
  ({ id, kind: "capture", started_at, ended_at: null, expert: "Sabine", agent_id: A, off_record_ranges: [], workmap, ...(process_id ? { process_id } : {}) }) as unknown as SessionDigest;

// Legacy: confirmed, not linked, not ready (score 0). Linked: a draft on the session, the process holds the
// confirmed, ready Work Map.
const LEGACY = session("legacy-1", "2026-09-01T08:00:00.000Z", wm("Legacy task", true, "Legacy rule", 0));
const LINKED = session("linked-1", "2026-09-02T08:00:00.000Z", wm("Draft", false, "Draft rule", 0), P);
const PROCESS: Process = {
  id: P,
  workspace_id: "w",
  agent_id: A,
  title: "Pay invoices",
  workmap: wm("Pay invoices", true, "Process rule", 1),
  version: 2,
  confirmed: true,
  archived_at: null,
  created_by: null,
  created_at: "2026-09-02T08:00:00.000Z",
  updated_at: "2026-09-03T08:00:00.000Z",
};
const AGENT = { id: A, name: "AP Clerk", role: "AP", expert_name: "Sabine", avatar: { shape: "round", face: "calm", color: "#8E95A3", accent: "#62A9F3" } } as unknown as Agent;

const state = vi.hoisted(() => {
  const props: Record<string, Record<string, unknown>> = {};
  const capture = (name: string) => ({ default: (p: Record<string, unknown>) => ((props[name] = p), null) });
  return { input: null as unknown, props, capture };
});

vi.mock("next/navigation", () => ({ redirect: vi.fn(), notFound: vi.fn(() => { throw new Error("notFound"); }) }));
vi.mock("@/lib/auth/context", () => ({
  getRequestContext: async () => ({ kind: "ok", ctx: { mode: "supabase", role: "owner", email: "lena@example.test", userId: "u", workspaceId: "w" } }),
}));
vi.mock("@/lib/dashboard/agents", () => ({
  loadAgentsInput: async () => state.input,
  loadAgentProcesses: async () => (state.input as Input).processes,
}));
vi.mock("@/components/shell/AppShell", () => ({ default: ({ children }: { children: unknown }) => children }));
vi.mock("@/components/agents/AgentsHome", () => state.capture("AgentsHome"));
vi.mock("@/components/agents/AgentDetail", () => state.capture("AgentDetail"));
vi.mock("@/components/agents/LearnView", () => state.capture("LearnView"));

import AgentPage from "./[id]/page";
import AgentsPage from "./page";
import LearnPage from "../learn/page";

type Input = AgentsInput & { processes: Process[] };

/** Props of the view element under the (mocked) AppShell. */
const viewProps = (el: ReactElement) => (el.props as { children: ReactElement }).children.props as Record<string, unknown>;

beforeEach(() => {
  const input: Input = { agents: [AGENT], sessions: [LINKED, LEGACY], processes: [PROCESS], members: [], createdBy: {} };
  state.input = input;
});

describe("agents callers pass processes merged with legacy sessions", () => {
  it("gallery cards and filter counts count the process plus the unlinked legacy session", async () => {
    const { cards } = viewProps(await AgentsPage()) as { cards: GalleryCard[] };
    expect(cards[0].stats).toMatchObject({ processes: 2, guardrails: 2 });
    // Ready only through the process (the legacy map is below the bar, the linked session is a draft).
    expect(cards[0].status).toBe("ready");
    expect(filterCards(cards, "", "ready")).toHaveLength(1);
    expect(filterCards(cards, "", "training")).toHaveLength(0);
  });

  it("agent page header stats and tabs read the merged Work Maps", async () => {
    const props = viewProps(await AgentPage({ params: Promise.resolve({ id: A }), searchParams: Promise.resolve({}) }));
    expect(props.stats).toMatchObject({ processes: 2, guardrails: 2 });
    expect((props.processes as ProcessRow[]).map((p) => [p.task, p.href, p.ready])).toEqual([
      ["Pay invoices", "/map/linked-1", true],
      ["Legacy task", "/map/legacy-1", false],
    ]);
    expect((props.guardrails as { rule: string }[]).map((g) => g.rule)).toEqual(["Process rule", "Legacy rule"]);
  });

  it("without processes (migration missing) the session rule applies", async () => {
    (state.input as Input).processes = [];
    const { cards } = viewProps(await AgentsPage()) as { cards: GalleryCard[] };
    expect(cards[0].stats).toMatchObject({ processes: 1, guardrails: 1 });
    expect(cards[0].status).toBe("training");
  });
});

describe("Learn reads agentWorkMaps", () => {
  it("offers the agent through its ready process and lists the process (Teach on its linked session with ?process) and the legacy map", async () => {
    const props = viewProps(await LearnPage({ searchParams: Promise.resolve({ agent: A }) }));
    expect((props.agents as GalleryCard[]).map((a) => a.id)).toEqual([A]);
    const processes = props.processes as LearnProcess[];
    expect(processes.map((p) => [p.task, p.ready, p.teachHref])).toEqual([
      ["Pay invoices", true, `/teach?agent=${A}&session=linked-1&process=${P}`],
      ["Legacy task", false, `/teach?agent=${A}&session=legacy-1`],
    ]);
    expect(processes[0].focus).toEqual(["Step 1 · Check the amount"]);
  });

  it("a process without a linked session is counted but not startable in Learn", async () => {
    (state.input as Input).sessions = [LEGACY];
    const props = viewProps(await LearnPage({ searchParams: Promise.resolve({ agent: A }) }));
    expect((props.processes as LearnProcess[]).map((p) => p.task)).toEqual(["Legacy task"]);
    expect((props.agents as GalleryCard[])[0].stats.processes).toBe(2);
  });
});
