// POST /api/voice/usage: validation, clamp, one update per token scoped to kind, token, workspace and user.
import { beforeEach, describe, expect, it, vi } from "vitest";

type Row = { id: number; kind: string; session_id: string; workspace_id: string; user_id: string; voice_seconds: number | null };

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";
const TOKEN = "v_0f8fad5b-d9cb-469f-a165-70867728950e";

const h = vi.hoisted(() => ({
  ctx: { mode: "supabase", userId: "u1", workspaceId: "", role: "learner" } as Record<string, unknown>,
  rows: [] as Row[],
  updates: 0,
}));

vi.mock("@/lib/auth/context", () => ({
  requireContext: async () => ({ email: null, workspaceName: "W", supabase: null, memberships: [], ...h.ctx }),
}));

// Fake admin client: update().match().is().select() and select().match().limit() over h.rows.
vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      if (table !== "usage_events") throw new Error(`unexpected table ${table}`);
      const filters: ((r: Row) => boolean)[] = [];
      const match = (m: Record<string, unknown>) => filters.push((r) => Object.entries(m).every(([k, v]) => r[k as keyof Row] === v));
      const hits = () => h.rows.filter((r) => filters.every((f) => f(r)));
      return {
        update: (patch: Partial<Row>) => {
          const q = {
            match: (m: Record<string, unknown>) => (match(m), q),
            is: (col: keyof Row, v: null) => (filters.push((r) => r[col] === v), q),
            select: async () => {
              h.updates++;
              const rows = hits();
              rows.forEach((r) => Object.assign(r, patch));
              return { data: rows.map((r) => ({ id: r.id })), error: null };
            },
          };
          return q;
        },
        select: () => {
          const q = {
            match: (m: Record<string, unknown>) => (match(m), q),
            limit: async (n: number) => ({ data: hits().slice(0, n).map((r) => ({ id: r.id })), error: null }),
          };
          return q;
        },
      };
    },
  }),
}));

import { POST } from "./route";

const post = (body: unknown) =>
  POST(new Request("http://x/api/voice/usage", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));

beforeEach(() => {
  h.ctx = { mode: "supabase", userId: "u1", workspaceId: WS_A, role: "learner" };
  h.rows = [{ id: 1, kind: "voice", session_id: TOKEN, workspace_id: WS_A, user_id: "u1", voice_seconds: null }];
  h.updates = 0;
});

describe("POST /api/voice/usage", () => {
  it("sets the seconds once and answers 200 {ok:true, seconds}", async () => {
    const res = await post({ usage_token: TOKEN, seconds: 93.5 });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, seconds: 93.5 });
    expect(h.rows[0].voice_seconds).toBe(93.5);
  });

  it("clamps to 7200 and a negative value to 0", async () => {
    expect(await (await post({ usage_token: TOKEN, seconds: 99_999 })).json()).toEqual({ ok: true, seconds: 7200 });
    expect(h.rows[0].voice_seconds).toBe(7200);
    h.rows[0].voice_seconds = null;
    expect(await (await post({ usage_token: TOKEN, seconds: -5 })).json()).toEqual({ ok: true, seconds: 0 });
    expect(h.rows[0].voice_seconds).toBe(0);
  });

  it.each([
    ["not json", "{"],
    ["null", null],
    ["missing token", { seconds: 3 }],
    ["token not a string", { usage_token: 7, seconds: 3 }],
    ["token wrong shape", { usage_token: "v_abc", seconds: 3 }],
    ["token without prefix", { usage_token: TOKEN.slice(2), seconds: 3 }],
    ["seconds a string", { usage_token: TOKEN, seconds: "3" }],
    ["seconds NaN", '{"usage_token":"' + TOKEN + '","seconds":NaN}'],
    ["seconds missing", { usage_token: TOKEN }],
  ])("answers 400 on junk: %s", async (_name, body) => {
    const res = await post(body);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "invalid body" });
    expect(h.updates).toBe(0);
  });

  it("answers 404 for an unknown token", async () => {
    const res = await post({ usage_token: "v_00000000-0000-4000-8000-000000000000", seconds: 3 });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "unknown token" });
  });

  it("answers 409 on the second post", async () => {
    expect((await post({ usage_token: TOKEN, seconds: 10 })).status).toBe(200);
    const res = await post({ usage_token: TOKEN, seconds: 4000 });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "already recorded" });
    expect(h.rows[0].voice_seconds).toBe(10);
  });

  it("answers 404 to a member of another workspace and leaves the row alone", async () => {
    h.rows.push({ id: 2, kind: "voice", session_id: "v_11111111-1111-4111-8111-111111111111", workspace_id: WS_B, user_id: "u1", voice_seconds: 5 });
    h.ctx = { mode: "supabase", userId: "u1", workspaceId: WS_B, role: "owner" };
    const res = await post({ usage_token: TOKEN, seconds: 30 });
    expect(res.status).toBe(404);
    expect(h.rows[0].voice_seconds).toBeNull();
  });

  it("answers 404 to another user of the same workspace, even once recorded", async () => {
    h.ctx = { mode: "supabase", userId: "u2", workspaceId: WS_A, role: "owner" };
    expect((await post({ usage_token: TOKEN, seconds: 30 })).status).toBe(404);
    h.rows[0].voice_seconds = 12;
    expect((await post({ usage_token: TOKEN, seconds: 30 })).status).toBe(404);
    expect(h.rows[0].voice_seconds).toBe(12);
  });

  it("ignores rows of another kind with the same session_id", async () => {
    h.rows[0].kind = "vision";
    expect((await post({ usage_token: TOKEN, seconds: 30 })).status).toBe(404);
  });

  it("local mode answers 200 {ok:true, local:true} without touching the DB", async () => {
    h.ctx = { mode: "local", userId: "local", workspaceId: "local", role: "owner" };
    const res = await post({ usage_token: TOKEN, seconds: 30 });
    expect(await res.json()).toEqual({ ok: true, local: true });
    expect(h.updates).toBe(0);
    expect(h.rows[0].voice_seconds).toBeNull();
  });
});
