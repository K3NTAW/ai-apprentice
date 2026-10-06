// GET /api/workspace/cost over a fake Supabase client that records the query and applies eq/gte/limit like PostgREST.
// requireContext is mocked: the context carries the user client (never admin) and the active workspace.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";

type Call = [string, ...unknown[]];
const state = vi.hoisted(() => ({
  rows: [] as Record<string, unknown>[],
  calls: [] as Call[],
  applyFilters: true,
  ctx: null as unknown,
}));

function fakeClient() {
  const filters: ((r: Record<string, unknown>) => boolean)[] = [];
  let limit = Infinity;
  const q = {
    select: (...a: unknown[]) => (state.calls.push(["select", ...a]), q),
    eq: (col: string, v: unknown) => (state.calls.push(["eq", col, v]), filters.push((r) => r[col] === v), q),
    gte: (col: string, v: string) => (state.calls.push(["gte", col, v]), filters.push((r) => String(r[col]) >= v), q),
    order: (...a: unknown[]) => (state.calls.push(["order", ...a]), q),
    limit: (n: number) => (state.calls.push(["limit", n]), (limit = n), q),
    then: (res: (v: unknown) => unknown) => {
      const rows = state.applyFilters ? state.rows.filter((r) => filters.every((f) => f(r))) : state.rows;
      return Promise.resolve({ data: rows.slice(0, limit), error: null }).then(res);
    },
  };
  return { from: (t: string) => (state.calls.push(["from", t]), q) };
}

vi.mock("@/lib/auth/context", () => ({ requireContext: async () => state.ctx }));

import { GET } from "./route";
import { mapCostRow, zurichCutoff } from "./cost";

const ctxFor = (workspaceId: string, role = "member") => ({ mode: "supabase", userId: "u1", workspaceId, role, supabase: fakeClient() });
const get = async (qs = "") => {
  const res = await GET(new Request(`http://localhost/api/workspace/cost${qs}`));
  return { status: res.status, body: await res.json() };
};
const row = (workspace_id: string, day: string, kind = "vision", extra: Record<string, unknown> = {}) => ({
  workspace_id,
  day,
  kind,
  events: "2",
  input_tokens: "100",
  output_tokens: "20",
  cache_read_tokens: "0",
  voice_seconds: null,
  bytes: null,
  chf: "0.0123",
  unpriced_events: "0",
  ...extra,
});

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T10:00:00Z"));
  state.calls = [];
  state.applyFilters = true;
  state.rows = [row(WS_A, "2026-10-05"), row(WS_B, "2026-10-05", "decide")];
  state.ctx = ctxFor(WS_A);
});

afterEach(() => vi.useRealTimers());

describe("GET /api/workspace/cost", () => {
  it("filters by the active workspace in the query, two workspaces", async () => {
    const a = await get();
    expect(a.status).toBe(200);
    expect(state.calls).toContainEqual(["from", "usage_cost_daily"]);
    expect(state.calls).toContainEqual(["eq", "workspace_id", WS_A]);
    expect(a.body.rows.map((r: { kind: string }) => r.kind)).toEqual(["vision"]);

    state.calls = [];
    state.ctx = ctxFor(WS_B, "owner");
    const b = await get();
    expect(state.calls).toContainEqual(["eq", "workspace_id", WS_B]);
    expect(b.body.rows.map((r: { kind: string }) => r.kind)).toEqual(["decide"]);
  });

  it("drops a foreign row the client still returns", async () => {
    state.applyFilters = false;
    const { body } = await get();
    expect(state.calls).toContainEqual(["eq", "workspace_id", WS_A]);
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].kind).toBe("vision");
  });

  it("orders by day desc and caps the query at 500 rows", async () => {
    await get();
    expect(state.calls).toContainEqual(["order", "day", { ascending: false }]);
    expect(state.calls).toContainEqual(["limit", 500]);
  });

  it.each(["0", "91", "abc", "1.5", "-3", ""])("answers 400 for days=%s", async (d) => {
    const res = await get(`?days=${d}`);
    expect(res).toEqual({ status: 400, body: { error: "invalid days" } });
    expect(state.calls).toEqual([]);
  });

  it("defaults to 30 days and accepts 1 and 90", async () => {
    expect((await get()).body.days).toBe(30);
    expect(state.calls).toContainEqual(["gte", "day", "2026-09-07"]);
    expect((await get("?days=1")).body.days).toBe(1);
    expect(state.calls).toContainEqual(["gte", "day", "2026-10-06"]);
    expect((await get("?days=90")).body.days).toBe(90);
  });

  it("computes the cut-off in Europe/Zurich", async () => {
    // 23:30 UTC on 6 October is 01:30 on 7 October in Zurich (CEST).
    vi.setSystemTime(new Date("2026-10-06T23:30:00Z"));
    await get("?days=1");
    expect(state.calls).toContainEqual(["gte", "day", "2026-10-07"]);
    await get("?days=7");
    expect(state.calls).toContainEqual(["gte", "day", "2026-10-01"]);
    expect(zurichCutoff(30, new Date("2026-03-01T12:00:00Z"))).toBe("2026-01-31");
  });

  it("maps rows defensively", async () => {
    state.rows = [
      row(WS_A, "2026-10-05", "vision"),
      row(WS_A, "2026-10-05", "frame", { chf: null, bytes: "2048", input_tokens: null }),
      row(WS_A, "2026-10-04", "mystery", { events: "NaN", unpriced_events: "3", chf: "x" }),
      row(WS_A, "not-a-day"),
      row(WS_A, "2026-10-03", "decide", { unpriced_events: null }),
    ];
    const { body } = await get();
    expect(body.rows).toEqual([
      { day: "2026-10-05", kind: "vision", events: 2, input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, voice_seconds: null, bytes: null, chf: 0.0123, unpriced_events: 0 },
      { day: "2026-10-05", kind: "frame", events: 2, input_tokens: null, output_tokens: 20, cache_read_tokens: 0, voice_seconds: null, bytes: 2048, chf: null, unpriced_events: 0 },
      { day: "2026-10-04", kind: "other", events: null, input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, voice_seconds: null, bytes: null, chf: null, unpriced_events: 3 },
      { day: "2026-10-03", kind: "decide", events: 2, input_tokens: 100, output_tokens: 20, cache_read_tokens: 0, voice_seconds: null, bytes: null, chf: 0.0123, unpriced_events: 0 },
    ]);
    expect(mapCostRow(null)).toBeNull();
    expect(mapCostRow({ day: 20261005 })).toBeNull();
  });

  it("sets truncated when 500 rows come back", async () => {
    state.rows = Array.from({ length: 520 }, () => row(WS_A, "2026-10-05"));
    const full = await get();
    expect(full.body.truncated).toBe(true);
    expect(full.body.rows).toHaveLength(500);
    state.rows = Array.from({ length: 499 }, () => row(WS_A, "2026-10-05"));
    expect((await get()).body.truncated).toBe(false);
  });

  it("local mode answers an empty local list", async () => {
    state.ctx = { mode: "local", userId: "local", workspaceId: "local", role: "owner", supabase: null };
    expect(await get("?days=7")).toEqual({ status: 200, body: { days: 7, truncated: false, rows: [], local: true } });
  });

  it("passes a requireContext response through", async () => {
    state.ctx = Response.json({ error: "unauthorized" }, { status: 401 });
    expect((await get()).status).toBe(401);
  });
});
