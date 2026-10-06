import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RequestContext } from "@/lib/auth/context";

type Res = { error: { code?: string; message?: string } | null };

const h = vi.hoisted(() => ({
  pending: [] as Promise<unknown>[],
  afterThrows: false,
  rows: [] as unknown[],
  tables: [] as string[],
  behave: (async () => ({ error: null })) as (signal: AbortSignal) => Promise<Res>,
  warn: vi.fn(),
}));

vi.mock("next/server", () => ({
  after: vi.fn((cb: () => unknown) => {
    if (h.afterThrows) throw new Error("`after` was called outside a request scope");
    h.pending.push(Promise.resolve(cb()));
  }),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createSupabaseAdminClient: () => ({
    from: (table: string) => {
      h.tables.push(table);
      return {
        insert: (row: unknown) => {
          h.rows.push(row);
          return { abortSignal: (signal: AbortSignal) => h.behave(signal) };
        },
      };
    },
  }),
}));

vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: h.warn, error: vi.fn() } }));

const WS = "11111111-1111-4111-8111-111111111111";

function ctx(mode: "local" | "supabase" = "supabase"): RequestContext {
  return {
    mode,
    userId: "u1",
    email: null,
    workspaceId: WS,
    workspaceName: "W",
    role: "owner",
    supabase: null,
    memberships: [],
  };
}

let ev: typeof import("./events");

const flush = async () => {
  await Promise.all(h.pending.splice(0));
};
const usageWarns = () => h.warn.mock.calls.filter((c) => c[0] === "usage.events");

beforeEach(async () => {
  vi.resetModules();
  h.pending = [];
  h.afterThrows = false;
  h.rows = [];
  h.tables = [];
  h.behave = async () => ({ error: null });
  h.warn.mockReset();
  vi.stubEnv("USAGE_EVENTS", "");
  ev = await import("./events");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("usageEventsEnabled", () => {
  it("is on in supabase mode, off in local mode and with USAGE_EVENTS=0", () => {
    expect(ev.usageEventsEnabled(ctx())).toBe(true);
    expect(ev.usageEventsEnabled(ctx("local"))).toBe(false);
    vi.stubEnv("USAGE_EVENTS", "0");
    expect(ev.usageEventsEnabled(ctx())).toBe(false);
  });

  it("records nothing when disabled", async () => {
    vi.stubEnv("USAGE_EVENTS", "0");
    ev.recordUsage(ctx(), { kind: "vision" });
    ev.recordUsage(ctx("local"), { kind: "vision" });
    vi.stubEnv("USAGE_EVENTS", "");
    ev.recordUsage(ctx("local"), { kind: "vision" });
    expect(h.pending).toHaveLength(0);
    expect(h.rows).toHaveLength(0);
    expect(await ev.insertUsageEvent(ctx("local"), { kind: "vision" })).toEqual({ ok: false, reason: "disabled" });
  });
});

describe("recordUsage", () => {
  it("returns synchronously and schedules the insert through after() with every field", async () => {
    const { after } = await import("next/server");
    const out = ev.recordUsage(ctx(), {
      kind: "vision",
      model: "claude-haiku-4-5-20251001",
      input_tokens: 100,
      output_tokens: 20,
      cache_read_tokens: 5,
      voice_seconds: 1.5,
      bytes: 2048,
      session_id: "s1",
    });
    expect(out).toBeUndefined();
    expect(after).toHaveBeenCalledTimes(1);
    await flush();
    expect(h.tables).toEqual(["usage_events"]);
    expect(h.rows).toEqual([
      {
        workspace_id: WS,
        user_id: "u1",
        session_id: "s1",
        kind: "vision",
        model: "claude-haiku-4-5-20251001",
        input_tokens: 100,
        output_tokens: 20,
        cache_read_tokens: 5,
        voice_seconds: 1.5,
        bytes: 2048,
      },
    ]);
    expect(usageWarns()).toHaveLength(0);
  });

  it("a rejecting insert logs one warn and never throws", async () => {
    h.behave = async () => {
      throw new Error("network down");
    };
    expect(() => ev.recordUsage(ctx(), { kind: "decide" })).not.toThrow();
    await flush();
    expect(usageWarns()).toHaveLength(1);
    expect(usageWarns()[0][1]).toMatchObject({ reason: "insert_threw", kind: "decide" });
  });

  it("an insert error logs one warn", async () => {
    h.behave = async () => ({ error: { code: "XX000", message: "boom" } });
    ev.recordUsage(ctx(), { kind: "workmap" });
    await flush();
    expect(usageWarns()).toHaveLength(1);
    expect(usageWarns()[0][1]).toMatchObject({ reason: "insert_error", code: "XX000" });
  });

  it("a hanging insert is aborted at 5 s with one warn", async () => {
    vi.useFakeTimers();
    let seen: AbortSignal | undefined;
    h.behave = (signal) => {
      seen = signal;
      return new Promise<Res>(() => {});
    };
    ev.recordUsage(ctx(), { kind: "vision" });
    const done = flush();
    await vi.advanceTimersByTimeAsync(ev.INSERT_TIMEOUT_MS - 1);
    expect(seen?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(seen?.aborted).toBe(true);
    expect(usageWarns()).toHaveLength(1);
    expect(usageWarns()[0][1]).toMatchObject({ reason: "timeout" });
  });

  it("after() outside a request scope logs one warn and drops the event", () => {
    h.afterThrows = true;
    expect(() => ev.recordUsage(ctx(), { kind: "frame", bytes: 10 })).not.toThrow();
    expect(usageWarns()).toHaveLength(1);
    expect(usageWarns()[0][1]).toMatchObject({ reason: "no_request_scope", kind: "frame" });
    expect(h.rows).toHaveLength(0);
  });

  it("a throwing logger never reaches the caller", async () => {
    h.afterThrows = true;
    h.warn.mockImplementation(() => {
      throw new Error("logger down");
    });
    expect(() => ev.recordUsage(ctx(), { kind: "vision" })).not.toThrow();
    h.afterThrows = false;
    h.behave = async () => {
      throw new Error("x");
    };
    expect(await ev.insertUsageEvent(ctx(), { kind: "vision" })).toEqual({ ok: false, reason: "error" });
  });

  it("a missing table (42P01) silences inserts for 5 minutes, then retries", async () => {
    vi.useFakeTimers({ now: new Date("2026-10-06T10:00:00Z") });
    h.behave = async () => ({ error: { code: "42P01", message: 'relation "public.usage_events" does not exist' } });
    ev.recordUsage(ctx(), { kind: "vision" });
    await flush();
    expect(h.rows).toHaveLength(1);
    expect(ev.isTableMissing()).toBe(true);
    expect(usageWarns()).toHaveLength(1);

    vi.advanceTimersByTime(ev.MISSING_TABLE_BACKOFF_MS - 1);
    ev.recordUsage(ctx(), { kind: "vision" });
    await flush();
    expect(h.rows).toHaveLength(1);
    expect(await ev.insertUsageEvent(ctx(), { kind: "voice" })).toEqual({ ok: false, reason: "disabled" });
    expect(usageWarns()).toHaveLength(1);

    vi.advanceTimersByTime(1);
    expect(ev.isTableMissing()).toBe(false);
    h.behave = async () => ({ error: null });
    ev.recordUsage(ctx(), { kind: "vision" });
    await flush();
    expect(h.rows).toHaveLength(2);
  });
});

describe("insertUsageEvent", () => {
  it("returns ok on success", async () => {
    expect(await ev.insertUsageEvent(ctx(), { kind: "voice", voice_seconds: 30, session_id: "tok" })).toEqual({ ok: true });
  });

  it("maps 23505 to conflict without a warn", async () => {
    h.behave = async () => ({ error: { code: "23505", message: "duplicate key" } });
    expect(await ev.insertUsageEvent(ctx(), { kind: "voice", voice_seconds: 30, session_id: "tok" })).toEqual({
      ok: false,
      reason: "conflict",
    });
    expect(usageWarns()).toHaveLength(0);
  });
});
