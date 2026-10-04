// /api/agents and POST /api/session with agent_id, in supabase mode over the in-memory FakeSupabase.
// Boundaries mocked: env mode, the Supabase server client, next/headers. requireContext and the store run for real.
import { beforeEach, describe, expect, it, vi } from "vitest";
import { FakeSupabase } from "@/lib/store/fakeSupabase";
import { createSupabaseStore } from "@/lib/store/supabase";

const USER = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const OTHER = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";

const state = vi.hoisted(() => ({
  fake: null as unknown as FakeSupabase,
  role: "owner",
  signedIn: true,
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
// Delete with data runs with the service role after the owner check; the fake stands in for it.
vi.mock("@/lib/supabase/admin", () => ({ createSupabaseAdminClient: () => state.fake.client }));

import { POST as sessionPost } from "../session/route";
import { DELETE as agentDelete, GET as agentGet, PATCH as agentPatch } from "./[id]/route";
import { GET as listGet, POST as createPost } from "./route";

const avatar = { shape: "blob", face: "smile", color: "#3366FF", accent: "#FFCC00" };
const body = { name: "Senior Sales Person", role: "Sales", expert_name: "Sabine", avatar };

const req = (method: string, payload?: unknown) =>
  new Request("http://localhost/api/agents", payload === undefined ? { method } : { method, body: JSON.stringify(payload) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Creates an agent in ws as uid, writing past RLS the way that user would. */
async function seed(ws: string, uid: string): Promise<string> {
  const fake = state.fake;
  const prevUid = fake.uid;
  const wasVisible = fake.visibleWorkspaces.has(ws);
  fake.uid = uid;
  fake.visibleWorkspaces.add(ws);
  const store = createSupabaseStore(fake.client as never, { workspaceId: ws, userId: uid });
  const a = await store.createAgent({ name: "Seeded", role: "Seed", avatar: avatar as never });
  fake.uid = prevUid;
  if (!wasVisible) fake.visibleWorkspaces.delete(ws);
  return a.id;
}

beforeEach(() => {
  state.fake = new FakeSupabase({ uid: USER, workspaces: [WS_A] });
  state.role = "owner";
  state.signedIn = true;
});

describe("/api/agents", () => {
  it("creates and lists agents of the active workspace", async () => {
    const res = await createPost(req("POST", body));
    expect(res.status).toBe(201);
    const a = await res.json();
    expect(a).toMatchObject({ ...body, workspace_id: WS_A });
    expect(state.fake.tables.agents[0]).toMatchObject({ id: a.id, created_by: USER });
    await seed(WS_B, OTHER);
    const list = await (await listGet()).json();
    expect(list.agents.map((x: { id: string }) => x.id)).toEqual([a.id]);
  });

  it("lets an expert create and a learner list but not create", async () => {
    state.role = "expert";
    expect((await createPost(req("POST", body))).status).toBe(201);
    state.role = "learner";
    const res = await createPost(req("POST", body));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect((await listGet()).status).toBe(200);
    expect(state.fake.tables.agents).toHaveLength(1);
  });

  it("rejects an invalid avatar, unknown keys and bad lengths", async () => {
    for (const bad of [
      { ...body, avatar: { ...avatar, shape: "cube" } },
      { ...body, avatar: { ...avatar, face: "angry" } },
      { ...body, avatar: { ...avatar, color: "blue" } },
      { ...body, avatar: { ...avatar, accent: "#FFF" } },
      { ...body, avatar: { ...avatar, onload: "x" } },
      { ...body, avatar: undefined },
      { ...body, name: "" },
      { ...body, name: "n".repeat(61) },
      { ...body, role: "r".repeat(81) },
      { ...body, extra: 1 },
    ]) {
      const res = await createPost(req("POST", bad));
      expect(res.status).toBe(400);
    }
    expect(state.fake.tables.agents).toHaveLength(0);
  });

  it("gets and patches an agent; the avatar is replaced as a whole", async () => {
    const a = await (await createPost(req("POST", body))).json();
    expect(await (await agentGet(req("GET"), params(a.id))).json()).toEqual(a);
    state.role = "expert";
    const next = { shape: "star", face: "robot", color: "#000000", accent: "#FFFFFF" };
    const res = await agentPatch(req("PATCH", { name: "Sales Lead", avatar: next, expert_name: null }), params(a.id));
    expect(res.status).toBe(200);
    const p = await res.json();
    expect(p).toMatchObject({ id: a.id, name: "Sales Lead", role: "Sales", avatar: next });
    expect(p.expert_name).toBeUndefined();
    expect((await agentPatch(req("PATCH", { avatar: { shape: "star" } }), params(a.id))).status).toBe(400);
    expect((await agentPatch(req("PATCH", { workspace_id: WS_B }), params(a.id))).status).toBe(400);
    expect((await agentPatch(req("PATCH", {}), params(a.id))).status).toBe(400);
    state.role = "learner";
    expect((await agentPatch(req("PATCH", { name: "x" }), params(a.id))).status).toBe(403);
  });

  it("deletes as owner only: capture sessions go, teach sessions stay with the link cleared", async () => {
    const a = await (await createPost(req("POST", body))).json();
    const s = await (await sessionPost(req("POST", { kind: "capture", agent_id: a.id }))).json();
    const t = await (await sessionPost(req("POST", { kind: "teach", agent_id: a.id }))).json();
    expect(s.agent_id).toBe(a.id);
    state.role = "expert";
    const denied = await agentDelete(req("DELETE"), params(a.id));
    expect(denied.status).toBe(403);
    state.role = "owner";
    expect((await agentDelete(req("DELETE"), params(a.id))).status).toBe(204);
    expect((await agentDelete(req("DELETE"), params(a.id))).status).toBe(404);
    expect((await agentGet(req("GET"), params(a.id))).status).toBe(404);
    expect(state.fake.tables.sessions.map((r) => r.id)).toEqual([t.id]);
    expect(state.fake.tables.sessions[0]).toMatchObject({ id: t.id, agent_id: null });
  });

  it("answers 404 for an agent of another workspace on every method", async () => {
    const id = await seed(WS_B, OTHER);
    for (const res of [
      await agentGet(req("GET"), params(id)),
      await agentPatch(req("PATCH", { name: "x" }), params(id)),
      await agentDelete(req("DELETE"), params(id)),
      await agentGet(req("GET"), params("not-a-uuid")),
    ]) {
      expect(res.status).toBe(404);
    }
    expect(state.fake.tables.agents[0]).toMatchObject({ id, name: "Seeded" });
  });

  it("POST /api/session takes agent_id only from the active workspace", async () => {
    const foreign = await seed(WS_B, OTHER);
    const res = await sessionPost(req("POST", { kind: "teach", agent_id: foreign }));
    expect(res.status).toBe(404);
    expect((await sessionPost(req("POST", { kind: "teach", agent_id: "x" }))).status).toBe(400);
    expect(state.fake.tables.sessions).toHaveLength(0);
  });

  it("POST /api/session answers 404 when the agent is deleted between the check and the insert (23503)", async () => {
    const id = await seed(WS_A, USER);
    state.fake.failNext("sessions", {
      message: 'insert or update on table "sessions" violates foreign key constraint "sessions_agent_fkey"',
      code: "23503",
    });
    const res = await sessionPost(req("POST", { kind: "teach", agent_id: id }));
    expect(res.status).toBe(404);
    expect(state.fake.tables.sessions).toHaveLength(0);
  });

  it("answers 401 when signed out", async () => {
    state.signedIn = false;
    for (const res of [
      await listGet(),
      await createPost(req("POST", body)),
      await agentGet(req("GET"), params(USER)),
      await agentPatch(req("PATCH", { name: "x" }), params(USER)),
      await agentDelete(req("DELETE"), params(USER)),
    ]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });
});
