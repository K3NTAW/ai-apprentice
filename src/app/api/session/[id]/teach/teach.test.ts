// POST /api/session/[id]/teach in supabase mode over the in-memory FakeSupabase.
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

import { POST } from "./route";

const progress = (extra: Record<string, unknown> = {}) => ({ workmap_session_id: "s_map", mastered: ["a"], practice: ["b"], interventions: 1, ...extra });
const post = (id: string, payload: unknown) =>
  POST(new Request(`http://localhost/api/session/${id}/teach`, { method: "POST", body: JSON.stringify(payload) }), {
    params: Promise.resolve({ id }),
  });

/** Creates a teach session in ws as uid, writing past RLS the way that user would. */
async function seedSession(ws: string, uid: string): Promise<string> {
  const fake = state.fake;
  const prevUid = fake.uid;
  const wasVisible = fake.visibleWorkspaces.has(ws);
  fake.uid = uid;
  fake.visibleWorkspaces.add(ws);
  const s = await createSupabaseStore(fake.client as never, { workspaceId: ws, userId: uid }).createSession({ kind: "teach" });
  fake.uid = prevUid;
  if (!wasVisible) fake.visibleWorkspaces.delete(ws);
  return s.id;
}

const stored = (id: string) => state.fake.tables.sessions.find((r) => r.id === id)?.teach;

beforeEach(() => {
  state.fake = new FakeSupabase({ uid: USER, workspaces: [WS_A] });
  state.role = "learner";
  state.signedIn = true;
});

describe("POST /api/session/[id]/teach", () => {
  it("saves the creator's progress and unions mastered steps for the same Work Map", async () => {
    const id = await seedSession(WS_A, USER);
    const res = await post(id, { teach: progress() });
    expect(res.status).toBe(200);
    expect((await res.json()).teach).toEqual(progress());
    await post(id, { teach: progress({ mastered: ["c"], practice: [], interventions: 2 }) });
    expect(stored(id)).toEqual(progress({ mastered: ["a", "c"], practice: [], interventions: 2 }));
    await post(id, { teach: progress({ workmap_session_id: "s_other", mastered: ["z"] }) });
    expect(stored(id)).toMatchObject({ workmap_session_id: "s_other", mastered: ["z"] });
  });

  it("answers 401 signed out", async () => {
    const id = await seedSession(WS_A, USER);
    state.signedIn = false;
    expect((await post(id, { teach: progress() })).status).toBe(401);
    expect(stored(id)).toBeNull();
  });

  it("answers 403 to a member who did not create the session, and lets an owner save", async () => {
    const id = await seedSession(WS_A, OTHER);
    const res = await post(id, { teach: progress() });
    expect(res.status).toBe(403);
    expect(stored(id)).toBeNull();
    state.role = "owner";
    expect((await post(id, { teach: progress() })).status).toBe(200);
  });

  it("answers 404 for a session of another workspace, like a missing one", async () => {
    const foreign = await seedSession(WS_B, OTHER);
    state.role = "owner";
    const res = await post(foreign, { teach: progress() });
    expect(res.status).toBe(404);
    expect(stored(foreign)).toBeNull();
    expect((await post("s_missing", { teach: progress() })).status).toBe(404);
  });

  it("answers 400 for an invalid body", async () => {
    const id = await seedSession(WS_A, USER);
    for (const bad of [{}, { teach: progress({ interventions: -1 }) }, { teach: progress({ mastered: "a" }) }, { teach: progress(), x: 1 }])
      expect((await post(id, bad)).status).toBe(400);
    expect(stored(id)).toBeNull();
  });

  it("answers 503 teach_unavailable while the migration is not applied", async () => {
    const id = await seedSession(WS_A, USER);
    state.fake.missingTables.add("sessions.teach");
    const res = await post(id, { teach: progress() });
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "teach_unavailable" });
  });
});
