// Workspace scoping and roles for the session routes, in supabase mode over the in-memory FakeSupabase.
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
  role: "expert",
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
const describeFrame = vi.hoisted(() => vi.fn(async () => []));
vi.mock("@/lib/perception/vision", () => ({ describeFrame }));

import { GET as exportGet } from "./export/route";
import { POST as endPost } from "./session/[id]/end/route";
import { POST as eventsPost } from "./session/[id]/events/route";
import { GET as frameGet } from "./session/[id]/frames/[name]/route";
import { POST as offRecordPost } from "./session/[id]/off-record/route";
import { POST as qaPost } from "./session/[id]/qa/route";
import { GET as sessionGet } from "./session/[id]/route";
import { POST as transcriptPost } from "./session/[id]/transcript/route";
import { POST as sessionPost } from "./session/route";
import { POST as visionPost } from "./vision/route";
import { POST as confirmPost } from "./workmap/confirm/route";
import { POST as workmapPost } from "./workmap/route";

const req = (body?: unknown, url = "http://localhost/api/x") =>
  new Request(url, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) });
const params = (id: string) => ({ params: Promise.resolve({ id }) });

/** Creates a session in ws as uid, writing past RLS the way that user would. */
async function seed(ws: string, uid: string): Promise<string> {
  const fake = state.fake;
  const prevUid = fake.uid;
  const wasVisible = fake.visibleWorkspaces.has(ws);
  fake.uid = uid;
  fake.visibleWorkspaces.add(ws);
  const store = createSupabaseStore(fake.client as never, { workspaceId: ws, userId: uid });
  const s = await store.createSession({ kind: "capture", expert: "Sabine Keller" });
  await store.saveFrame(s.id, 1, Buffer.from("jpeg"));
  fake.uid = prevUid;
  if (!wasVisible) fake.visibleWorkspaces.delete(ws);
  return s.id;
}

const ROUTES: { name: string; call: (id: string) => Promise<Response> }[] = [
  { name: "GET session", call: (id) => sessionGet(req(), params(id)) },
  { name: "events", call: (id) => eventsPost(req({ events: [] }), params(id)) },
  { name: "transcript", call: (id) => transcriptPost(req({ entries: [] }), params(id)) },
  {
    name: "qa",
    call: (id) => qaPost(req({ qa: { id: "q1", t_question: 1, question: "why?", phase: "capture" } }), params(id)),
  },
  { name: "off-record", call: (id) => offRecordPost(req({ from: 1 }), params(id)) },
  { name: "end", call: (id) => endPost(req({}), params(id)) },
  { name: "frames", call: (id) => frameGet(req(), { params: Promise.resolve({ id, name: "0001.jpg" }) }) },
  { name: "workmap", call: (id) => workmapPost(req({ session_id: id })) },
  { name: "workmap/confirm", call: (id) => confirmPost(req({ session_id: id, confirmed: true })) },
  { name: "export", call: (id) => exportGet(req(undefined, `http://localhost/api/export?session_id=${id}`)) },
  { name: "vision", call: (id) => visionPost(req({ session_id: id, t: 2, frame: "aGVsbG8=" })) },
];

beforeEach(() => {
  state.fake = new FakeSupabase({ uid: USER, workspaces: [WS_A] });
  state.role = "expert";
  describeFrame.mockClear();
});

describe("cross-workspace session ids answer 404 like missing ones", () => {
  it.each(ROUTES)("$name", async ({ call }) => {
    const foreign = await seed(WS_B, USER);
    const missing = "missing_session_1";
    const a = await call(foreign);
    const b = await call(missing);
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    const norm = (body: unknown, id: string) => JSON.stringify(body).replaceAll(id, "<id>");
    expect(norm(await a.json(), foreign)).toBe(norm(await b.json(), missing));
    expect(describeFrame).not.toHaveBeenCalled();
  });

  it("the same routes still work for a session in the active workspace", async () => {
    const own = await seed(WS_A, USER);
    expect((await sessionGet(req(), params(own))).status).toBe(200);
    const frame = await frameGet(req(), { params: Promise.resolve({ id: own, name: "0001.jpg" }) });
    expect(frame.status).toBe(200);
    expect(frame.headers.get("cache-control")).toBe("private, no-store");
    expect((await eventsPost(req({ events: [] }), params(own))).status).toBe(200);
  });
});

describe("roles", () => {
  it("a learner POSTing a capture session gets 403, a teach session 201", async () => {
    state.role = "learner";
    const capture = await sessionPost(req({ kind: "capture" }));
    expect(capture.status).toBe(403);
    expect(state.fake.tables.sessions).toHaveLength(0);
    const teach = await sessionPost(req({ kind: "teach" }));
    expect(teach.status).toBe(201);
    expect(state.fake.tables.sessions[0]).toMatchObject({ workspace_id: WS_A, created_by: USER, kind: "teach" });
  });

  it("an expert may create a capture session", async () => {
    expect((await sessionPost(req({ kind: "capture" }))).status).toBe(201);
  });

  it("a non-creator non-owner confirming a Work Map gets 403; ending too", async () => {
    const theirs = await seed(WS_A, OTHER);
    const res = await confirmPost(req({ session_id: theirs, confirmed: true }));
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "forbidden" });
    expect((await endPost(req({}), params(theirs))).status).toBe(403);
  });

  it("an owner may end another member's session", async () => {
    state.role = "owner";
    const theirs = await seed(WS_A, OTHER);
    expect((await endPost(req({}), params(theirs))).status).toBe(200);
  });

  it("a learner may read a capture session of the workspace", async () => {
    state.role = "learner";
    const theirs = await seed(WS_A, OTHER);
    expect((await sessionGet(req(), params(theirs))).status).toBe(200);
  });
});
