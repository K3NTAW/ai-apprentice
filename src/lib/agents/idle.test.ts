// Idle-capture ports (T-0270 review findings): the Supabase port against the store's FakeSupabase, the per-run cap
// and the file port's endedAt.
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fileStore } from "@/lib/store";
import { FakeSupabase } from "@/lib/store/fakeSupabase";
import { endIdleCaptures, fileIdleCapturePort, IDLE_BATCH, IDLE_CAPTURE_MS, supabaseIdleCapturePort } from "./admin";

const WS = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-10-04T12:00:00Z");
const CUTOFF = NOW - IDLE_CAPTURE_MS;

/**
 * The fake has no lt or is. The adapter maps lt(c, ts) to lte(c, ts - 1 ms) (the fake stores ms precision) and
 * is(c, null) to its eq(c, null), which matches SQL null like Postgres 'is null'. Every call is recorded.
 */
function client(fake: FakeSupabase, calls: string[]): SupabaseClient {
  const wrap = (q: Record<string, unknown>, table: string): unknown =>
    new Proxy(q, {
      get(t, prop) {
        if (prop === "lt")
          return (c: string, v: string) => {
            calls.push(`${table}.lt(${c})`);
            return wrap((t.lte as (c: string, v: string) => Record<string, unknown>)(c, new Date(Date.parse(v) - 1).toISOString()), table);
          };
        if (prop === "is")
          return (c: string, v: null) => {
            if (v !== null) throw new Error("is() only with null");
            calls.push(`${table}.is(${c},null)`);
            return wrap((t.eq as (c: string, v: null) => Record<string, unknown>)(c, null), table);
          };
        const val = Reflect.get(t, prop, t);
        if (typeof val !== "function") return val;
        if (prop === "then") return val.bind(t);
        return (...args: unknown[]) => {
          if (typeof prop === "string") calls.push(`${table}.${prop}(${typeof args[0] === "string" ? args[0] : ""})`);
          const r = val.apply(t, args);
          return r === t ? wrap(t, table) : r;
        };
      },
    });
  const c = fake.client as { from(t: string): Record<string, unknown> };
  return { from: (table: string) => wrap(c.from(table), table) } as unknown as SupabaseClient;
}

const iso = (ms: number) => new Date(ms).toISOString().replace("Z", "+00:00");
const H = 60 * 60 * 1000;

function seed(fake: FakeSupabase) {
  const session = (id: string, startedMs: number, over: Record<string, unknown> = {}) =>
    fake.tables.sessions.push({ id, workspace_id: WS, kind: "capture", started_at: iso(startedMs), ended_at: null, agent_id: null, ...over });
  // Started 5 h ago, last event at +1 h (4 h ago): idle.
  session("old", NOW - 5 * H);
  fake.tables.session_events.push({ id: 1, session_id: "old", t: 3600 });
  // Started 3 h ago, latest frame 2.5 h in (30 min ago): active.
  session("busy", NOW - 3 * H);
  fake.tables.session_events.push({ id: 2, session_id: "busy", t: 60 });
  fake.tables.session_transcript.push({ id: 3, session_id: "busy", t: 120 });
  fake.tables.session_frames.push({ session_id: "busy", name: "f1.jpg", t: 9000, storage_path: `${WS}/x/busy/f1.jpg` });
  // Started 6 h ago, nothing recorded: idle.
  session("empty", NOW - 6 * H);
  // Not candidates: ended, teach, started after the cutoff.
  session("ended", NOW - 7 * H, { ended_at: iso(NOW - 6 * H) });
  session("teach", NOW - 7 * H, { kind: "teach" });
  session("fresh", NOW - H);
}

describe("supabaseIdleCapturePort (FakeSupabase)", () => {
  it("reads open captures oldest first and the latest t of events, transcript and frames; ends only the idle ones", async () => {
    const fake = new FakeSupabase({ uid: "u", workspaces: [WS] });
    seed(fake);
    const calls: string[] = [];
    const port = supabaseIdleCapturePort(client(fake, calls));
    const { captures, total } = await port.openCaptures(CUTOFF, IDLE_BATCH);
    expect(captures).toEqual([
      { id: "empty", started_at: iso(NOW - 6 * H), last_t: null },
      { id: "old", started_at: iso(NOW - 5 * H), last_t: 3600 },
      { id: "busy", started_at: iso(NOW - 3 * H), last_t: 9000 },
    ]);
    expect(total).toBe(3);
    expect(calls).toContain("sessions.is(ended_at,null)");
    expect(calls).toContain("sessions.lt(started_at)");
    for (const t of ["session_events", "session_transcript", "session_frames"]) {
      expect(calls).toContain(`${t}.select(t)`);
      expect(calls).toContain(`${t}.order(t)`);
    }

    expect(await endIdleCaptures(port, NOW)).toEqual({ ended: 2, remaining: 0 });
    const endedAt = (id: string) => fake.tables.sessions.find((r) => r.id === id)?.ended_at;
    expect(endedAt("old")).toBe(iso(NOW));
    expect(endedAt("empty")).toBe(iso(NOW));
    expect(endedAt("busy")).toBeNull();
    // An already ended session keeps its ended_at (is ended_at null on the update).
    expect(endedAt("ended")).toBe(iso(NOW - 6 * H));
    await port.endSessions(["ended", "old"], new Date(NOW + H).toISOString());
    expect(endedAt("ended")).toBe(iso(NOW - 6 * H));
    expect(endedAt("old")).toBe(iso(NOW));
  });

  it("42703 (no t column) on a child table fails the run and ends nothing", async () => {
    const fake = new FakeSupabase({ uid: "u", workspaces: [WS] });
    seed(fake);
    fake.failNext("session_transcript", { message: "column session_transcript.t does not exist", code: "42703" });
    const port = supabaseIdleCapturePort(client(fake, []));
    await expect(endIdleCaptures(port, NOW)).rejects.toThrow(/select session_transcript: column session_transcript.t does not exist/);
    expect(fake.tables.sessions.filter((r) => r.ended_at === null)).toHaveLength(5);
  });

  it("a missing child table (PGRST205) fails the run and ends nothing; a missing sessions table too", async () => {
    for (const missing of ["session_frames", "sessions"]) {
      const fake = new FakeSupabase({ uid: "u", workspaces: [WS], missingTables: [missing] });
      seed(fake);
      const port = supabaseIdleCapturePort(client(fake, []));
      await expect(endIdleCaptures(port, NOW), missing).rejects.toThrow(new RegExp(`Could not find the table 'public.${missing}'`));
      expect(fake.tables.sessions.filter((r) => r.ended_at === null), missing).toHaveLength(5);
    }
  });

  it("checks at most `batch` open captures per run, oldest first, and reports the rest as remaining", async () => {
    const fake = new FakeSupabase({ uid: "u", workspaces: [WS] });
    for (let i = 0; i < 7; i++)
      fake.tables.sessions.push({ id: `s${i}`, workspace_id: WS, kind: "capture", started_at: iso(NOW - (10 + i) * H), ended_at: null, agent_id: null });
    const calls: string[] = [];
    const port = supabaseIdleCapturePort(client(fake, calls));
    expect(await endIdleCaptures(port, NOW, IDLE_CAPTURE_MS, 3)).toEqual({ ended: 3, remaining: 4 });
    // Oldest first: s6, s5, s4.
    expect(fake.tables.sessions.filter((r) => r.ended_at !== null).map((r) => r.id).sort()).toEqual(["s4", "s5", "s6"]);
    // Three latest-t reads per checked session, no more.
    expect(calls.filter((c) => c === "session_events.select(t)")).toHaveLength(3);
    expect(await endIdleCaptures(port, NOW, IDLE_CAPTURE_MS, 3)).toEqual({ ended: 3, remaining: 1 });
    expect(await endIdleCaptures(port, NOW, IDLE_CAPTURE_MS, 3)).toEqual({ ended: 1, remaining: 0 });
    expect(IDLE_BATCH).toBe(50);
  });
});

describe("fileIdleCapturePort", () => {
  let dir: string;
  const prev = process.env.DATA_DIR;
  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "apprentice-idle-"));
    process.env.DATA_DIR = dir;
  });
  afterAll(async () => {
    if (prev === undefined) delete process.env.DATA_DIR;
    else process.env.DATA_DIR = prev;
    await rm(dir, { recursive: true, force: true });
  });

  it("endSessions writes the given endedAt and never moves an existing ended_at", async () => {
    const a = await fileStore.createSession({ kind: "capture" });
    const port = fileIdleCapturePort();
    await port.endSessions([a.id], "2026-10-04T12:00:00.000Z");
    expect((await fileStore.getSession(a.id))?.ended_at).toBe("2026-10-04T12:00:00.000Z");
    await port.endSessions([a.id], "2026-10-04T13:00:00.000Z");
    expect((await fileStore.getSession(a.id))?.ended_at).toBe("2026-10-04T12:00:00.000Z");
  });

  it("openCaptures is capped, oldest first, and reports the total", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) ids.push((await fileStore.createSession({ kind: "capture" })).id);
    const { captures, total } = await fileIdleCapturePort().openCaptures(Date.now() + 1000, 2);
    expect(total).toBe(3);
    expect(captures).toHaveLength(2);
    expect(captures.every((c) => ids.includes(c.id))).toBe(true);
    expect(Date.parse(captures[0].started_at)).toBeLessThanOrEqual(Date.parse(captures[1].started_at));
  });
});
