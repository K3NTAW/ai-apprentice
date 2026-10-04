// /api/processes in supabase mode over the in-memory FakeSupabase.
// Boundaries mocked: env mode, the Supabase server client, next/headers. requireContext and the store run for real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/store/fakeSupabase";
import { createSupabaseStore } from "@/lib/store/supabase";
import type { WorkMap } from "@/lib/types";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  fake: null as unknown as FakeSupabase,
  role: "owner",
}));

function membershipQuery() {
  const rows = [{ workspace_id: WS_A, role: state.role, created_at: "2026-10-01T00:00:00Z", workspaces: { name: "A" } }];
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
      auth: { getUser: async () => ({ data: { user: { id: USER, email: "u@example.test" } }, error: null }) },
      from: (table: string) => (table === "workspace_members" ? membershipQuery() : inner.from(table)),
      rpc: async () => ({ data: [], error: null }),
      storage: inner.storage,
    };
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { DELETE as processDelete, GET as processGet, PATCH as processPatch } from "./[id]/route";
import { GET as versionsGet } from "./[id]/versions/route";
import { GET as listGet, POST as createPost } from "./route";

const avatar = { shape: "blob", face: "smile", color: "#3366FF", accent: "#FFCC00" } as const;
const workmap: WorkMap = { task: "pay invoice", expert: "Sabine", confirmed_by_expert: true, steps: [], open_questions: [] };

const req = (method: string, payload?: unknown, query = "") =>
  new Request(`http://localhost/api/processes${query}`, payload === undefined ? { method } : { method, body: JSON.stringify(payload) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function agent(ws = WS_A): Promise<string> {
  const had = state.fake.visibleWorkspaces.has(ws);
  state.fake.visibleWorkspaces.add(ws);
  const a = await createSupabaseStore(state.fake.client as never, { workspaceId: ws, userId: USER }).createAgent({ name: "Pip", role: "AP", avatar });
  if (!had) state.fake.visibleWorkspaces.delete(ws);
  return a.id;
}

beforeEach(() => {
  state.fake = new FakeSupabase({ uid: USER, workspaces: [WS_A] });
  state.role = "owner";
});

describe("/api/processes", () => {
  it("creates, lists, reads, edits with a new version, archives and deletes a process", async () => {
    const agentId = await agent();
    const created = await createPost(req("POST", { agent_id: agentId, title: "Pay invoices", workmap }));
    expect(created.status).toBe(201);
    const p = (await created.json()) as { id: string; version: number };
    expect(p.version).toBe(1);

    const list = await listGet(req("GET", undefined, `?agent_id=${agentId}`));
    expect(((await list.json()) as { processes: { id: string }[] }).processes.map((x) => x.id)).toEqual([p.id]);
    expect((await processGet(req("GET"), params(p.id))).status).toBe(200);

    const edited = await processPatch(req("PATCH", { workmap: { ...workmap, open_questions: ["why?"] } }), params(p.id));
    expect(((await edited.json()) as { version: number }).version).toBe(2);
    const versions = (await (await versionsGet(req("GET"), params(p.id))).json()) as { versions: { version: number; change_kind: string }[] };
    expect(versions.versions.map((v) => [v.version, v.change_kind])).toEqual([
      [2, "edited"],
      [1, "trained"],
    ]);

    await processPatch(req("PATCH", { archived: true }), params(p.id));
    expect(((await (await listGet(req("GET"))).json()) as { processes: unknown[] }).processes).toEqual([]);
    expect(((await (await listGet(req("GET", undefined, "?archived=1"))).json()) as { processes: unknown[] }).processes).toHaveLength(1);

    expect((await processDelete(req("DELETE"), params(p.id))).status).toBe(204);
    expect((await processGet(req("GET"), params(p.id))).status).toBe(404);
    expect((await processDelete(req("DELETE"), params(p.id))).status).toBe(404);
  });

  it("lets experts write but only owners delete; learners cannot write", async () => {
    const agentId = await agent();
    const p = (await (await createPost(req("POST", { agent_id: agentId, title: "T", workmap }))).json()) as { id: string };
    state.role = "expert";
    expect((await processPatch(req("PATCH", { title: "Renamed" }), params(p.id))).status).toBe(200);
    expect((await processDelete(req("DELETE"), params(p.id))).status).toBe(403);
    state.role = "learner";
    expect((await createPost(req("POST", { agent_id: agentId, title: "T", workmap }))).status).toBe(403);
    expect((await processPatch(req("PATCH", { title: "x" }), params(p.id))).status).toBe(403);
    expect((await processGet(req("GET"), params(p.id))).status).toBe(200);
  });

  it("answers 400 for a bad body and 404 for a missing agent, process or another workspace's process", async () => {
    const agentId = await agent();
    expect((await createPost(req("POST", { agent_id: agentId, title: "", workmap }))).status).toBe(400);
    expect((await createPost(req("POST", { agent_id: agentId, title: "T", workmap, extra: 1 }))).status).toBe(400);
    expect((await createPost(req("POST", { agent_id: await agent(WS_B), title: "T", workmap }))).status).toBe(404);
    expect((await processPatch(req("PATCH", {}), params(agentId))).status).toBe(400);
    expect((await processPatch(req("PATCH", { title: "x" }), params("00000000-0000-4000-8000-00000000dead"))).status).toBe(404);
    expect((await versionsGet(req("GET"), params("not-a-uuid"))).status).toBe(404);
  });

  it("answers 503 'processes not available yet' on every route while the migration is missing, never 500", async () => {
    const agentId = await agent();
    state.fake.missingTables.add("processes");
    state.fake.missingTables.add("process_versions");
    const id = "00000000-0000-4000-8000-00000000beef";
    for (const res of [
      await listGet(req("GET")),
      await createPost(req("POST", { agent_id: agentId, title: "T", workmap })),
      await processGet(req("GET"), params(id)),
      await processPatch(req("PATCH", { title: "x" }), params(id)),
      await processDelete(req("DELETE"), params(id)),
      await versionsGet(req("GET"), params(id)),
    ]) {
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: "processes_unavailable", message: "processes not available yet" });
    }
  });
});
