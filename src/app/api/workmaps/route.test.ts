// GET /api/workmaps in supabase mode over the in-memory FakeSupabase: 401 signed out, cross-workspace 404,
// the confirmed and agent filters, ?session_id, the limit, the sort order and a bounded query count.
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
const wm = (confirmed: boolean, task: string): WorkMap => ({ task, expert: "Sabine", confirmed_by_expert: confirmed, steps: [], open_questions: [] });
const get = (query = "") => GET(new Request(`http://localhost/api/workmaps${query}`));
const tick = () => new Promise((r) => setTimeout(r, 3));

let ids: Record<string, string>;
let agentA: string;
let agentB: string;

beforeEach(async () => {
  state.signedIn = true;
  state.fake = new FakeSupabase({ uid: USER, workspaces: [WS_A, WS_B] });
  const client = state.fake.client as never;
  const a = createSupabaseStore(client, { workspaceId: WS_A, userId: USER });
  const b = createSupabaseStore(client, { workspaceId: WS_B, userId: USER });
  agentA = (await a.createAgent({ name: "A", role: "r", avatar })).id;
  agentB = (await b.createAgent({ name: "B", role: "r", avatar })).id;
  ids = {};
  for (const [key, confirmed, agent] of [
    ["old", true, agentA],
    ["draft", false, null],
    ["mid", true, null],
    ["new", true, agentA],
  ] as const) {
    const s = await a.createSession({ kind: "capture", ...(agent ? { agent_id: agent } : {}) });
    await a.saveWorkMap(s.id, wm(confirmed, key));
    ids[key] = s.id;
    await tick();
  }
  ids.bare = (await a.createSession({ kind: "capture" })).id;
  const foreign = await b.createSession({ kind: "capture", agent_id: agentB });
  await b.saveWorkMap(foreign.id, wm(true, "foreign"));
  ids.foreign = foreign.id;
});

describe("GET /api/workmaps", () => {
  it("401 signed out", async () => {
    state.signedIn = false;
    const res = await get();
    expect(res.status).toBe(401);
    expect(res.headers.get("Server-Timing")).toMatch(/^ctx-auth;dur=\d+(\.\d)?, db;dur=0\.0, total;dur=/);
  });

  it("lists the active workspace's maps newest first, all of them without ?confirmed", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Server-Timing")).toMatch(/^ctx-auth;dur=\d+(\.\d)?, db;dur=\d+(\.\d)?, total;dur=\d+(\.\d)?$/);
    const body = await res.json();
    expect(body.maps.map((m: { workmap: WorkMap }) => m.workmap.task)).toEqual(["new", "mid", "draft", "old"]);
    expect(body.session).toBeNull();
    expect(body.maps[0]).toMatchObject({ id: ids.new, kind: "capture", agent_id: agentA, ended_at: null });
  });

  it("?confirmed=1 returns only confirmed maps", async () => {
    const body = await (await get("?confirmed=1")).json();
    expect(body.maps.map((m: { id: string }) => m.id)).toEqual([ids.new, ids.mid, ids.old]);
  });

  it("?agent_id filters by agent; another workspace's, an unknown or a malformed agent answers 404", async () => {
    const body = await (await get(`?confirmed=1&agent_id=${agentA}`)).json();
    expect(body.maps.map((m: { id: string }) => m.id)).toEqual([ids.new, ids.old]);
    expect((await get(`?agent_id=${agentB}`)).status).toBe(404);
    expect((await get("?agent_id=00000000-0000-4000-8000-00000000dead")).status).toBe(404);
    expect((await get("?agent_id=nope")).status).toBe(404);
  });

  it("?session_id returns that map even when unconfirmed, null for a map-less or foreign session", async () => {
    expect((await (await get(`?confirmed=1&limit=1&session_id=${ids.draft}`)).json()).session).toMatchObject({ id: ids.draft });
    expect((await (await get(`?session_id=${ids.bare}`)).json()).session).toBeNull();
    expect((await (await get(`?session_id=${ids.foreign}`)).json()).session).toBeNull();
    expect((await get("?session_id=../x")).status).toBe(400);
  });

  it("caps the list at ?limit (1..200) and rejects anything else", async () => {
    expect((await (await get("?limit=2")).json()).maps).toHaveLength(2);
    for (const bad of ["0", "201", "1.5", "x"]) expect((await get(`?limit=${bad}`)).status).toBe(400);
  });

  it("issues a bounded number of queries: one sessions query, plus processes for Teach and the agent lookup", async () => {
    state.fake.calls = [];
    await get("?confirmed=1");
    expect(state.fake.calls.map((c) => c.table).sort()).toEqual(["processes", "sessions"]);
    state.fake.calls = [];
    await get(`?agent_id=${agentA}&session_id=${ids.draft}`);
    expect(state.fake.calls.map((c) => c.table).sort()).toEqual(["agents", "sessions"]);
  });
});
