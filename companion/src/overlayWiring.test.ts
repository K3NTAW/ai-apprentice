import { describe, expect, it } from "vitest";
import { CURSOR_POLL_MS, CursorPoller, SendGate, syncOverlayWindows, type OverlayWin, type TimerApi } from "./perf.mjs";

/** One shared event log so the order of timer and window calls can be checked. */
function harness(count = 2) {
  const events: string[] = [];
  const live = new Map<number, number>();
  let id = 0;
  // Timer factory: the cursor poller's intervals land in the log.
  const timers: TimerApi = {
    setInterval: (_fn, ms) => {
      live.set(++id, ms);
      events.push(`timer:start:${ms}`);
      return id;
    },
    clearInterval: (h) => {
      live.delete(h as number);
      events.push("timer:stop");
    },
  };
  // Window factory: fake overlay windows that record every call.
  const makeWin = (n: number) => {
    let visible = false;
    const win: OverlayWin & { focused: boolean } = {
      focused: false,
      isDestroyed: () => false,
      isVisible: () => visible,
      showInactive: () => {
        visible = true;
        events.push(`win${n}:showInactive`);
      },
      hide: () => {
        visible = false;
        events.push(`win${n}:hide`);
      },
      webContents: { send: (ch, arg) => events.push(`win${n}:${ch}:${arg === null ? "null" : "data"}`) },
    };
    return win;
  };
  const overlays = new Map<number, OverlayWin>();
  for (let i = 1; i <= count; i++) overlays.set(i, makeWin(i));
  const cursor = new CursorPoller(timers, { now: () => 0, read: () => ({ x: 0, y: 0 }), push: () => {}, canResume: () => true });
  const sent = new SendGate();
  type Model = { buddy: boolean; target: { x: number } | null; halos: unknown[] };
  const run = (o: { mode?: "capture" | "teach" | null; wantCursor: boolean; model: Model; ready?: boolean }) =>
    syncOverlayWindows({
      overlays,
      ready: () => o.ready ?? true,
      mode: o.mode ?? "teach",
      wantCursor: o.wantCursor,
      model: () => o.model,
      cursor,
      sent,
    });
  return { events, live, overlays, cursor, run };
}

const buddy = { buddy: true, target: null, halos: [] };
const empty = { buddy: false, target: null, halos: [] };

describe("syncOverlayWindows (main.mts overlay wiring)", () => {
  it("shows overlays with showInactive only when overlayShown() is true", () => {
    const h = harness();
    expect(h.run({ wantCursor: true, model: buddy })).toBe(true);
    expect(h.events).toContain("win1:showInactive");
    expect(h.events).toContain("win2:showInactive");
    expect(h.events.some((e) => e.includes("focus") || e.endsWith(":show"))).toBe(false);
    for (const w of h.overlays.values()) expect((w as OverlayWin & { focused: boolean }).focused).toBe(false);
  });

  it("keeps overlays hidden when overlayShown() is false: capture, nothing to draw, or not ready", () => {
    for (const o of [
      { mode: "capture" as const, wantCursor: true, model: buddy },
      { wantCursor: false, model: buddy },
      { wantCursor: true, model: empty },
      { wantCursor: true, model: buddy, ready: false },
    ]) {
      const h = harness();
      h.run(o);
      expect(h.events.filter((e) => e.endsWith("showInactive"))).toEqual([]);
    }
  });

  it("starts the cursor loop before the view that wakes the overlay animation", () => {
    const h = harness();
    h.run({ wantCursor: true, model: buddy });
    const start = h.events.indexOf(`timer:start:${CURSOR_POLL_MS}`);
    expect(start).toBeGreaterThanOrEqual(0);
    const firstView = h.events.findIndex((e) => e.includes(":buddy-view:"));
    const firstShow = h.events.findIndex((e) => e.endsWith(":showInactive"));
    expect(start).toBeLessThan(firstView);
    expect(start).toBeLessThan(firstShow);
  });

  it("stops the cursor loop and the animation feed when the overlays hide", () => {
    const h = harness();
    h.run({ wantCursor: true, model: buddy });
    expect(h.cursor.running).toBe(true);
    h.events.length = 0;
    // Capture mode: the buddy is hidden there.
    expect(h.run({ mode: "capture", wantCursor: true, model: buddy })).toBe(false);
    expect(h.cursor.running).toBe(false);
    expect(h.live.size).toBe(0);
    expect(h.events).toContain("timer:stop");
    expect(h.events).toContain("win1:hide");
    expect(h.events).toContain("win2:hide");
    // A null cursor ends the overlay's cursor-driven animation.
    expect(h.events).toContain("win1:cursor:null");
    expect(h.events).toContain("win2:cursor:null");
  });

  it("halos keep the overlay shown without a cursor loop", () => {
    const h = harness(1);
    expect(h.run({ wantCursor: false, model: { buddy: false, target: null, halos: [{}] } })).toBe(false);
    expect(h.events).toContain("win1:showInactive");
    expect(h.cursor.running).toBe(false);
  });
});
