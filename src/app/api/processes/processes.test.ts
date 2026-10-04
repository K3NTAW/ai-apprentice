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
    const inner = state.fake.client as { from: (t: string) => unknown; rpc: (fn: string, args: unknown) => unknown; storage: unknown };
    return {
      auth: { getUser: async () => ({ data: { user: { id: USER, email: "u@example.test" } }, error: null }) },
      from: (table: string) => (table === "workspace_members" ? membershipQuery() : inner.from(table)),
      rpc: async (fn: string, args: unknown) => (fn === "update_process" || fn === "create_process" ? inner.rpc(fn, args) : { data: [], error: null }),
      storage: inner.storage,
    };
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

import { DELETE as processDelete, GET as processGet, PATCH as processPatch } from "./[id]/route";
import { GET as versionsGet } from "./[id]/versions/route";
import { POST as backfillPost } from "./backfill/route";
import { GET as listGet, POST as createPost } from "./route";

const avatar = { shape: "blob", face: "smile", color: "#3366FF", accent: "#FFCC00" } as const;
const step: WorkMap["steps"][number] = { n: 1, title: "s", decision: "d", is_judgment_call: false, screen_moment: { t: 0, entity: "e" }, guardrails: [], scores: { reason_captured: 1, guardrail_captured: 1 }, reason: null };
const workmap: WorkMap = { task: "pay invoice", expert: "Sabine", confirmed_by_expert: true, steps: [step], open_questions: [] };

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

  it("archive, restore and delete are owner actions: experts get 403 and nothing changes", async () => {
    const agentId = await agent();
    const p = (await (await createPost(req("POST", { agent_id: agentId, title: "T", workmap }))).json()) as { id: string };
    state.role = "expert";
    expect((await processPatch(req("PATCH", { archived: true }), params(p.id))).status).toBe(403);
    expect((await processPatch(req("PATCH", { title: "x", archived: true }), params(p.id))).status).toBe(403);
    expect((await processDelete(req("DELETE"), params(p.id))).status).toBe(403);
    expect(((await (await processGet(req("GET"), params(p.id))).json()) as { title: string; archived_at: string | null })).toMatchObject({
      title: "T",
      archived_at: null,
    });
    state.role = "owner";
    expect((await processPatch(req("PATCH", { archived: true }), params(p.id))).status).toBe(200);
    state.role = "expert";
    expect((await processPatch(req("PATCH", { archived: false }), params(p.id))).status).toBe(403);
    state.role = "owner";
    expect(((await (await processPatch(req("PATCH", { archived: false }), params(p.id))).json()) as { archived_at: unknown }).archived_at).toBeNull();
  });

  it("derives confirmed from the Work Map and never accepts it from the client", async () => {
    const agentId = await agent();
    expect((await createPost(req("POST", { agent_id: agentId, title: "T", workmap, confirmed: false }))).status).toBe(400);
    const draft = { ...workmap, confirmed_by_expert: false };
    const p = (await (await createPost(req("POST", { agent_id: agentId, title: "T", workmap: draft }))).json()) as { id: string; confirmed: boolean };
    expect(p.confirmed).toBe(false);
    expect((await processPatch(req("PATCH", { confirmed: true }), params(p.id))).status).toBe(400);
    const res = await processPatch(req("PATCH", { workmap }), params(p.id));
    expect(((await res.json()) as { confirmed: boolean }).confirmed).toBe(true);
  });

  it("answers 409 for a stale expected_version and writes nothing", async () => {
    const agentId = await agent();
    const p = (await (await createPost(req("POST", { agent_id: agentId, title: "T", workmap }))).json()) as { id: string };
    const first = await processPatch(req("PATCH", { workmap: { ...workmap, task: "first" }, expected_version: 1 }), params(p.id));
    expect(first.status).toBe(200);
    const stale = await processPatch(req("PATCH", { workmap: { ...workmap, task: "second" }, expected_version: 1 }), params(p.id));
    expect(stale.status).toBe(409);
    expect(((await stale.json()) as { error: string }).error).toBe("process_version_conflict");
    const now = (await (await processGet(req("GET"), params(p.id))).json()) as { version: number; workmap: WorkMap };
    expect(now).toMatchObject({ version: 2, workmap: { task: "first" } });
    const versions = (await (await versionsGet(req("GET"), params(p.id))).json()) as { versions: { version: number }[] };
    expect(versions.versions.map((v) => v.version)).toEqual([2, 1]);
  });

  it("backfills processes from legacy confirmed sessions once, owner only", async () => {
    const agentId = await agent();
    const store = createSupabaseStore(state.fake.client as never, { workspaceId: WS_A, userId: USER });
    const s = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: agentId });
    await store.saveWorkMap(s.id, workmap);
    state.role = "expert";
    expect((await backfillPost(req("POST"))).status).toBe(403);
    state.role = "owner";
    const first = (await (await backfillPost(req("POST"))).json()) as { created: number; processes: { title: string }[] };
    expect(first).toMatchObject({ created: 1, processes: [{ title: "pay invoice" }] });
    expect(((await (await backfillPost(req("POST", { agent_id: agentId }))).json()) as { created: number }).created).toBe(0);
    expect((await backfillPost(req("POST", { nope: 1 }))).status).toBe(400);
    state.fake.missingTables.add("processes");
    expect((await backfillPost(req("POST"))).status).toBe(503);
  });

  it("PATCH with workmap, title and archived is one rpc call; a stale one changes nothing; title or archive alone add no version", async () => {
    const agentId = await agent();
    const p = (await (await createPost(req("POST", { agent_id: agentId, title: "T", workmap }))).json()) as { id: string };
    const patch = (body: unknown) => processPatch(req("PATCH", body), params(p.id));
    const before = state.fake.rpcCalls.length;
    const res = await patch({ workmap: { ...workmap, task: "v2" }, title: "T2", archived: true, expected_version: 1 });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ version: 2, title: "T2", workmap: { task: "v2" } });
    expect(state.fake.rpcCalls.slice(before).map((c) => c.fn)).toEqual(["update_process"]);
    const stale = await patch({ workmap, title: "Lost", archived: false, expected_version: 1 });
    expect(stale.status).toBe(409);
    expect(state.fake.tables.processes[0]).toMatchObject({ title: "T2", version: 2 });
    expect(state.fake.tables.processes[0].archived_at).not.toBeNull();
    expect((await patch({ title: "T3" })).status).toBe(200);
    expect((await patch({ archived: false })).status).toBe(200);
    expect(state.fake.tables.processes[0]).toMatchObject({ title: "T3", version: 2, archived_at: null });
    expect(state.fake.tables.process_versions.filter((v) => v.process_id === p.id)).toHaveLength(2);
  });

  it("backfill twice at once creates each process once", async () => {
    const agentId = await agent();
    const store = createSupabaseStore(state.fake.client as never, { workspaceId: WS_A, userId: USER });
    const s = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: agentId });
    await store.saveWorkMap(s.id, workmap);
    const [x, y] = await Promise.all([backfillPost(req("POST")), backfillPost(req("POST"))]);
    const created = [(await x.json()) as { created: number }, (await y.json()) as { created: number }].map((b) => b.created);
    expect(created.sort()).toEqual([0, 1]);
    expect(state.fake.tables.processes).toHaveLength(1);
  });

  it("answers 400 for an empty patch, 409 for a session of another process, and backfill skips a deleted process", async () => {
    const agentId = await agent();
    const store = createSupabaseStore(state.fake.client as never, { workspaceId: WS_A, userId: USER });
    const s = await store.createSession({ kind: "capture", expert: "Sabine", agent_id: agentId });
    await store.saveWorkMap(s.id, workmap);
    const backfilled = (await (await backfillPost(req("POST"))).json()) as { processes: { id: string }[] };
    const p = backfilled.processes[0];
    for (const body of [{}, { expected_version: 1 }, { change_kind: "edited" }])
      expect((await processPatch(req("PATCH", body), params(p.id))).status).toBe(400);
    const other = (await (await createPost(req("POST", { agent_id: agentId, title: "Other", workmap }))).json()) as { id: string };
    const stolen = await processPatch(req("PATCH", { title: "Stolen", source_session_id: s.id }), params(other.id));
    expect(stolen.status).toBe(409);
    expect(((await stolen.json()) as { error: string }).error).toBe("session_linked");
    expect(state.fake.tables.sessions.find((r) => r.id === s.id)?.process_id).toBe(p.id);
    expect((await processDelete(req("DELETE"), params(p.id))).status).toBe(204);
    expect(state.fake.tables.processes_tombstones).toMatchObject([{ source_session_id: s.id, workspace_id: WS_A }]);
    expect(((await (await backfillPost(req("POST"))).json()) as { created: number }).created).toBe(0);
    expect(state.fake.tables.processes.map((r) => r.id)).toEqual([other.id]);
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
