import { describe, expect, it } from "vitest";
import {
  allowThrottling,
  appPollMs,
  CURSOR_IDLE_MS,
  CURSOR_POLL_MS,
  CursorPoller,
  formatMetrics,
  perfEnabled,
  permissionPollMs,
  SendGate,
  sessionActive,
  TimerSet,
  type TimerApi,
} from "./perf.mjs";
import { cursorPollNeeded } from "./buddy.mjs";

/** Fake intervals: run() advances the clock by one tick of every live timer. */
function fakeTimers() {
  const live = new Map<number, { fn: () => void; ms: number }>();
  let id = 0;
  const api: TimerApi = {
    setInterval: (fn, ms) => {
      live.set(++id, { fn, ms });
      return id;
    },
    clearInterval: (h) => void live.delete(h as number),
  };
  return { api, live };
}

function poller(canResume = true) {
  const t = fakeTimers();
  let now = 0;
  let cur = { x: 1, y: 1 };
  const pushed: { x: number; y: number }[] = [];
  const p = new CursorPoller(t.api, { now: () => now, read: () => cur, push: (q) => pushed.push(q), canResume: () => canResume });
  return {
    p,
    t,
    pushed,
    move: (x: number, y: number) => (cur = { x, y }),
    /** Advance ms, firing the cursor timer at its period while it runs. */
    advance(ms: number) {
      const end = now + ms;
      while (now < end) {
        const timer = [...t.live.values()][0];
        if (!timer) {
          now = end;
          break;
        }
        now += timer.ms;
        timer.fn();
      }
    },
  };
}

describe("cursor polling", () => {
  it("is off while the buddy is hidden", () => {
    expect(cursorPollNeeded({ enabled: false, visible: true, paused: false, paired: true, sayActive: false })).toBe(false);
    const c = poller();
    c.p.set(false);
    expect(c.p.running).toBe(false);
    expect(c.t.live.size).toBe(0);
  });

  it("runs at most 30 Hz while the buddy is visible", () => {
    const c = poller();
    c.p.set(true);
    expect(c.p.running).toBe(true);
    expect(1000 / CURSOR_POLL_MS).toBeLessThanOrEqual(30);
    expect([...c.t.live.values()][0].ms).toBe(CURSOR_POLL_MS);
  });

  it("pauses after 2 s without movement and resumes on a mousemove", () => {
    const c = poller();
    c.p.set(true);
    c.advance(500);
    expect(c.pushed.length).toBe(1);
    c.advance(CURSOR_IDLE_MS + 100);
    expect(c.p.running).toBe(false);
    expect(c.p.paused).toBe(true);
    c.move(5, 5);
    c.p.moved();
    expect(c.p.running).toBe(true);
    c.advance(CURSOR_POLL_MS);
    expect(c.pushed.at(-1)).toEqual({ x: 5, y: 5 });
  });

  it("keeps polling while the cursor moves", () => {
    const c = poller();
    c.p.set(true);
    for (let i = 0; i < 100; i++) {
      c.move(i, i);
      c.advance(CURSOR_POLL_MS);
    }
    expect(c.p.running).toBe(true);
    expect(c.pushed.length).toBe(100);
  });

  it("never pauses without the input hook (no movement events to resume on)", () => {
    const c = poller(false);
    c.p.set(true);
    c.advance(CURSOR_IDLE_MS * 3);
    expect(c.p.running).toBe(true);
  });

  it("stops and forgets the idle state when the buddy hides", () => {
    const c = poller();
    c.p.set(true);
    c.advance(CURSOR_IDLE_MS + 500);
    c.p.set(false);
    expect(c.p.paused).toBe(false);
    c.p.moved();
    expect(c.p.running).toBe(false);
  });
});

describe("timers follow session state", () => {
  it("frontmost app every 500 ms in a session, else every 5 s", () => {
    expect(sessionActive({ paired: true, mode: "teach" })).toBe(true);
    expect(sessionActive({ paired: true, mode: "capture" })).toBe(true);
    expect(sessionActive({ paired: true, mode: null })).toBe(false);
    expect(sessionActive({ paired: false, mode: "teach" })).toBe(false);
    expect(appPollMs(true)).toBe(500);
    expect(appPollMs(false)).toBe(5_000);
  });

  it("permission poll every 10 s only while one is missing", () => {
    expect(permissionPollMs({ input: true, screen: true, accessibility: true })).toBeNull();
    expect(permissionPollMs({ input: false, screen: true, accessibility: true })).toBe(10_000);
    expect(permissionPollMs({ input: true, screen: false, accessibility: true })).toBe(10_000);
  });

  it("main window throttling only outside a session", () => {
    expect(allowThrottling(true)).toBe(false);
    expect(allowThrottling(false)).toBe(true);
  });

  it("a timer restarts only when its period changes, and quit clears all", () => {
    const t = fakeTimers();
    const set = new TimerSet(t.api);
    const a = set.add(() => {}, 500);
    set.add(() => {}, 250);
    const first = [...t.live.keys()];
    a.set(500);
    expect([...t.live.keys()]).toEqual(first);
    a.set(5_000);
    expect(t.live.size).toBe(2);
    expect([...t.live.values()].map((x) => x.ms).sort()).toEqual([250, 5_000]);
    set.clearAll();
    expect(t.live.size).toBe(0);
  });
});

describe("unchanged values are not re-sent", () => {
  it("SendGate passes only new values per key", () => {
    const g = new SendGate();
    expect(g.changed("cursor:1", { x: 1, y: 2 })).toBe(true);
    expect(g.changed("cursor:1", { x: 1, y: 2 })).toBe(false);
    expect(g.changed("cursor:2", { x: 1, y: 2 })).toBe(true);
    expect(g.changed("cursor:1", null)).toBe(true);
    expect(g.changed("cursor:1", null)).toBe(false);
    g.forget("cursor:1");
    expect(g.changed("cursor:1", null)).toBe(true);
  });

  it("the cursor poll pushes only when the point moved", () => {
    const c = poller();
    c.p.set(true);
    c.advance(CURSOR_POLL_MS * 10);
    expect(c.pushed.length).toBe(1);
  });
});

describe("COMPANION_PERF", () => {
  it("is opt-in and formats CPU per process", () => {
    expect(perfEnabled("1")).toBe(true);
    expect(perfEnabled(undefined)).toBe(false);
    const line = formatMetrics([
      { pid: 1, type: "Browser", cpu: { percentCPUUsage: 1.24 } },
      { pid: 2, type: "GPU", cpu: { percentCPUUsage: 2 } },
    ]);
    expect(line).toBe("cpu 3.2% | Browser:1 1.2 | GPU:2 2.0");
  });
});
