// GET /api/export?agent_id=<id>, in supabase mode over the in-memory FakeSupabase.
// Boundaries mocked: env mode, the Supabase server client, next/headers. requireContext and the store run for real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/store/fakeSupabase";
import { createSupabaseStore } from "@/lib/store/supabase";
import type { WorkMap } from "@/lib/types";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  fake: null as unknown as FakeSupabase,
  signedIn: true,
}));

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
      auth: {
        getUser: async () => ({ data: { user: state.signedIn ? { id: USER, email: "u@example.test" } : null }, error: null }),
      },
      from: (table: string) => (table === "workspace_members" ? membershipQuery() : inner.from(table)),
      rpc: async () => ({ data: [], error: null }),
      storage: inner.storage,
    };
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { GET } from "./route";

const avatar = { shape: "blob", face: "smile", color: "#3366FF", accent: "#FFCC00" };

const map = (task: string, rule: string, confirmed = true): WorkMap => ({
  task,
  expert: "Sabine",
  confirmed_by_expert: confirmed,
  open_questions: [],
  steps: [
    {
      n: 1,
      title: "Check the amount",
      screen_moment: { t: 12, entity: "invoice" },
      decision: "check",
      is_judgment_call: true,
      reason: null,
      guardrails: [{ rule, quote_ref: 0, kind: "limit" }],
      scores: { reason_captured: 1, guardrail_captured: 1 },
    },
  ],
});

/** An agent in ws with the given Work Maps, written past RLS the way uid would. */
async function seed(ws: string, uid: string, maps: WorkMap[]): Promise<string> {
  const fake = state.fake;
  const prevUid = fake.uid;
  const wasVisible = fake.visibleWorkspaces.has(ws);
  fake.uid = uid;
  fake.visibleWorkspaces.add(ws);
  const store = createSupabaseStore(fake.client as never, { workspaceId: ws, userId: uid });
  const a = await store.createAgent({ name: "Pip", role: "AP Clerk", avatar: avatar as never });
  for (const m of maps) {
    const s = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: a.id });
    await store.saveWorkMap(s.id, m);
  }
  fake.uid = prevUid;
  if (!wasVisible) fake.visibleWorkspaces.delete(ws);
  return a.id;
}

const get = (query: string) => GET(new Request(`http://localhost/api/export?${query}`));

beforeEach(() => {
  state.fake = new FakeSupabase({ uid: USER, workspaces: [WS_A] });
  state.signedIn = true;
});

describe("GET /api/export?agent_id with processes", () => {
  it("exports the confirmed, non-archived processes of the agent, titled by the process, when it has any", async () => {
    const id = await seed(WS_A, USER, [map("Session map", "Session rule")]);
    const store = createSupabaseStore(state.fake.client as never, { workspaceId: WS_A, userId: USER });
    await store.createProcess({ agent_id: id, title: "Pay invoices", workmap: map("old task", "Process rule") });
    const archived = await store.createProcess({ agent_id: id, title: "Old", workmap: map("x", "Archived rule") });
    await store.updateProcess(archived.id, { archived: true });
    await store.createProcess({ agent_id: id, title: "Draft", workmap: map("y", "Draft rule", false), confirmed: false });
    const md = await (await get(`agent_id=${id}`)).text();
    expect(md).toContain("## Agent instructions: Pay invoices");
    expect(md).toContain("Process rule");
    for (const gone of ["Session rule", "Archived rule", "Draft rule"]) expect(md).not.toContain(gone);
  });

  it("falls back to the confirmed sessions while the processes table is missing", async () => {
    const id = await seed(WS_A, USER, [map("Code invoices", "Never book above 5000")]);
    state.fake.missingTables.add("processes");
    const res = await get(`agent_id=${id}`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Never book above 5000");
  });
});

describe("GET /api/export?agent_id", () => {
  it("returns the guardrails of every confirmed Work Map of the agent, one section per process", async () => {
    const id = await seed(WS_A, USER, [map("Code invoices", "Never book above 5000"), map("Approve capex", "Stop at 10000"), map("Draft", "Not confirmed", false)]);
    const res = await get(`agent_id=${id}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const md = await res.text();
    expect(md.startsWith("# Guardrails: Pip\n")).toBe(true);
    expect(md).toContain("## Agent instructions: Code invoices");
    expect(md).toContain("## Agent instructions: Approve capex");
    expect(md).toContain("### Guardrails (never break)");
    expect(md).toContain("Never book above 5000");
    expect(md).toContain("Stop at 10000");
    expect(md).not.toContain("Not confirmed");
    expect(md).not.toContain("Draft");
  });

  it("answers 404 when the agent has no confirmed Work Map yet", async () => {
    const id = await seed(WS_A, USER, [map("Draft", "x", false)]);
    expect((await get(`agent_id=${id}`)).status).toBe(404);
  });

  it("answers 404 for an agent of another workspace", async () => {
    const foreign = await seed(WS_B, OTHER, [map("Theirs", "Secret rule")]);
    const res = await get(`agent_id=${foreign}`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain("Secret rule");
  });

  it("answers 401 when signed out", async () => {
    const id = await seed(WS_A, USER, [map("Code invoices", "Never book above 5000")]);
    state.signedIn = false;
    expect((await get(`agent_id=${id}`)).status).toBe(401);
  });

  it("still needs session_id or agent_id", async () => {
    expect((await get("")).status).toBe(400);
  });
});
