// GET /api/search in supabase mode over the in-memory FakeSupabase: 401 signed out, results from the active workspace
// only (agents, Work Map titles and steps, guardrails, sessions), no cross-workspace leakage, and the query cap.
// Boundaries mocked: env mode, the Supabase server client, next/headers. requireContext and the store run for real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/store/fakeSupabase";
import { createSupabaseStore } from "@/lib/store/supabase";
import type { Avatar, WorkMap } from "@/lib/types";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({ fake: null as unknown as FakeSupabase, signedIn: true }));

function membershipQuery() {
  const rows = [{ workspace_id: WS_A, role: "owner", created_at: "2026-10-01T00:00:00Z", workspaces: { name: "A" } }];
  const q: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(res);
        return () => q;
      },
    },
  );
  return q;
}

vi.mock("@/lib/supabase/env", () => ({ appMode: () => "supabase" }));
vi.mock("@/lib/supabase/server", () => ({
  createSupabaseServerClient: async () => {
    const inner = state.fake.client as { from: (t: string) => unknown; storage: unknown };
    return {
      auth: { getUser: async () => ({ data: { user: state.signedIn ? { id: USER } : null }, error: null }) },
      from: (table: string) => (table === "workspace_members" ? membershipQuery() : inner.from(table)),
      rpc: async () => ({ data: [], error: null }),
      storage: inner.storage,
    };
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { GET } from "./route";

const avatar: Avatar = { shape: "round", face: "calm", color: "#8E95A3", accent: "#62A9F3" };
const wm = (task: string, step: string, rule: string): WorkMap => ({
  task,
  expert: "Sabine",
  confirmed_by_expert: true,
  steps: [
    {
      n: 1,
      title: step,
      screen_moment: { t: 1, entity: "invoice" },
      decision: "d",
      is_judgment_call: true,
      reason: null,
      guardrails: [{ rule, quote_ref: 0, kind: "limit" }],
      scores: { reason_captured: 1, guardrail_captured: 1 },
    },
  ],
  open_questions: [],
});
const get = (q: string) => GET(new Request(`http://localhost/api/search?q=${encodeURIComponent(q)}`));

let mapA: string;

beforeEach(async () => {
  state.signedIn = true;
  state.fake = new FakeSupabase({ uid: USER, workspaces: [WS_A, WS_B] });
  const client = state.fake.client as never;
  const a = createSupabaseStore(client, { workspaceId: WS_A, userId: USER });
  const b = createSupabaseStore(client, { workspaceId: WS_B, userId: USER });
  const pip = await a.createAgent({ name: "Pip", role: "Supplier invoices", avatar });
  await b.createAgent({ name: "Pipster", role: "Supplier invoices", avatar });
  const s = await a.createSession({ kind: "capture", agent_id: pip.id });
  await a.saveWorkMap(s.id, wm("Supplier invoices", "Duplicate check", "Stop above 10k EUR"));
  mapA = s.id;
  const f = await b.createSession({ kind: "capture" });
  await b.saveWorkMap(f.id, wm("Supplier invoices B", "Duplicate check B", "Stop above 10k EUR B"));
});

describe("GET /api/search", () => {
  it("401 signed out", async () => {
    state.signedIn = false;
    expect((await get("pip")).status).toBe(401);
  });

  it("returns the active workspace's agents, Work Maps, steps, guardrails and sessions", async () => {
    const res = await get("supplier");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.agents.map((h: { title: string }) => h.title)).toEqual(["Pip"]);
    expect(body.workmaps).toEqual([{ id: mapA, title: "Supplier invoices", detail: "1 steps · confirmed", href: `/map/${mapA}` }]);
    expect(body.sessions.map((h: { id: string }) => h.id)).toEqual([mapA]);
    const step = await (await get("duplicate")).json();
    expect(step.workmaps).toEqual([{ id: `${mapA}#1`, title: "Supplier invoices", detail: "Step 1 · Duplicate check", href: `/map/${mapA}#step-1` }]);
    const rule = await (await get("10k")).json();
    expect(rule.guardrails.map((h: { title: string }) => h.title)).toEqual(["Stop above 10k EUR"]);
  });

  it("never leaks another workspace's rows", async () => {
    const text = JSON.stringify(await (await get("")).json()) + JSON.stringify(await (await get("pip")).json());
    expect(text).not.toContain("Pipster");
    expect(text).not.toMatch(/ B"/);
  });

  it("rejects a query over the cap", async () => {
    expect((await get("x".repeat(101))).status).toBe(400);
  });
});
