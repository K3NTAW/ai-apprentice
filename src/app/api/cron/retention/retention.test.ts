// /api/cron/retention: bearer CRON_SECRET or nothing. Signed-in users without the bearer get 401 too.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  run: vi.fn(async () => ({ agents: 1, deleted: 2, more: false })),
  purge: vi.fn(async () => ({ purged: 3 })),
  idle: vi.fn(async () => ({ ended: 4 })),
  ctx: vi.fn(),
}));
vi.mock("@/lib/auth/context", () => ({ requireContext: h.ctx }));
vi.mock("@/lib/supabase/env", () => ({ appMode: () => "local" }));
vi.mock("@/lib/agents/admin", async (orig) => ({ ...(await orig<typeof import("@/lib/agents/admin")>()), runRetention: h.run, fileDataPort: () => ({}), endIdleCaptures: h.idle, fileIdleCapturePort: () => ({}) }));
vi.mock("@/lib/capture/emptyPurge", () => ({ purgeEmptySessions: h.purge, fileEmptyPurgePort: () => ({}), supabaseEmptyPurgePort: () => ({}) }));

import { GET } from "./route";

const SECRET = "c".repeat(32);
const call = (auth?: string) => GET(new Request("http://localhost/api/cron/retention", { headers: auth ? { authorization: auth } : {} }));

beforeEach(() => {
  h.run.mockClear();
  h.purge.mockClear();
  h.idle.mockClear();
  h.ctx.mockReset();
  h.ctx.mockResolvedValue({ userId: "u", role: "owner" });
});
afterEach(() => vi.unstubAllEnvs());

describe("cron retention route", () => {
  it("rejects requests without the CRON_SECRET bearer, even from a signed-in owner", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    for (const auth of [undefined, "Bearer wrong", SECRET, `Basic ${SECRET}`]) {
      const res = await call(auth);
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
    expect(h.run).not.toHaveBeenCalled();
    expect(h.purge).not.toHaveBeenCalled();
    expect(h.idle).not.toHaveBeenCalled();
  });
  it("signed out without a bearer answers the requireContext response", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    h.ctx.mockResolvedValue(Response.json({ error: "unauthorized" }, { status: 401 }));
    expect((await call()).status).toBe(401);
  });
  it("fails closed when CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect((await call("Bearer undefined")).status).toBe(401);
    expect(h.run).not.toHaveBeenCalled();
  });
  it("runs retention with the right bearer", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    const res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agents: 1, deleted: 2, more: false, empty_purged: 3, ended_captures: 4 });
    expect(h.purge).toHaveBeenCalledTimes(1);
    expect(h.idle).toHaveBeenCalledTimes(1);
    expect(h.ctx).not.toHaveBeenCalled();
  });
  it("runs retention, the empty purge and idle-session ending independently and reports all three", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    h.run.mockRejectedValueOnce(new Error("storage down"));
    let res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "retention_failed", empty_purged: 3, ended_captures: 4 });
    expect(h.purge).toHaveBeenCalledTimes(1);
    expect(h.idle).toHaveBeenCalledTimes(1);

    h.purge.mockRejectedValueOnce(new Error("db down"));
    res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ agents: 1, deleted: 2, more: false, empty_error: "empty_purge_failed", ended_captures: 4 });
    expect(h.run).toHaveBeenCalledTimes(2);
    expect(h.idle).toHaveBeenCalledTimes(2);

    h.idle.mockRejectedValueOnce(new Error("db down"));
    res = await call(`Bearer ${SECRET}`);
    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ agents: 1, deleted: 2, more: false, empty_purged: 3, idle_error: "end_idle_failed" });
    expect(h.run).toHaveBeenCalledTimes(3);
    expect(h.purge).toHaveBeenCalledTimes(3);
  });
});

describe("endIdleCaptures", () => {
  it("ends capture sessions idle for more than 2 h, keeps active ones", async () => {
    const { endIdleCaptures, IDLE_CAPTURE_MS } = await vi.importActual<typeof import("@/lib/agents/admin")>("@/lib/agents/admin");
    const now = Date.parse("2026-10-04T12:00:00Z");
    const ended: string[][] = [];
    const port = {
      openCaptures: vi.fn(async () => [
        // Started 5 h ago, last event 4 h ago: idle.
        { id: "old", started_at: "2026-10-04T07:00:00Z", last_t: 3600 },
        // Started 5 h ago, nothing recorded: idle.
        { id: "empty", started_at: "2026-10-04T07:00:00Z", last_t: null },
        // Started 3 h ago, last event 30 min ago: still active.
        { id: "busy", started_at: "2026-10-04T09:00:00Z", last_t: 9000 },
      ]),
      endSessions: vi.fn<(ids: string[], endedAt?: string) => Promise<void>>(async (ids) => void ended.push(ids)),
    };
    expect(await endIdleCaptures(port, now)).toEqual({ ended: 2 });
    expect(port.openCaptures).toHaveBeenCalledWith(now - IDLE_CAPTURE_MS);
    expect(ended).toEqual([["old", "empty"]]);
    expect(port.endSessions.mock.calls[0][1]).toBe("2026-10-04T12:00:00.000Z");
  });
});
