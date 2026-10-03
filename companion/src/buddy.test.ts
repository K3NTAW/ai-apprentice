import { describe, expect, it } from "vitest";
import {
  anchorOf,
  buddyView,
  bubblePlacement,
  clampTtl,
  cursorPollNeeded,
  expireBuddy,
  FLY_MS,
  GLANCE_PAUSE_MS,
  initialBuddy,
  MAX_STOPS,
  reduceBuddy,
  SAY_TTL_MS,
  TTL_MAX_MS,
  TTL_MIN_MS,
  type BuddyAction,
} from "./buddy.mjs";
import { HALO_TTL_MS } from "./overlay.mjs";
import { parseClientMessage, toBuddyAction } from "./protocol.mjs";

const rect = { x: 0.1, y: 0.2, w: 0.3, h: 0.1 };
const run = (actions: [BuddyAction, number][]) => actions.reduce((s, [a, t]) => reduceBuddy(s, a, t), initialBuddy());

describe("buddy state", () => {
  it("transitions between all modes and starts idle", () => {
    let s = initialBuddy();
    expect(s.mode).toBe("idle");
    for (const m of ["listening", "thinking", "speaking", "paused", "idle"] as const) {
      s = reduceBuddy(s, { type: "state", state: m }, 0);
      expect(s.mode).toBe(m);
    }
    expect(buddyView(s, 0, { enabled: true, paused: true }).mode).toBe("paused");
  });

  it("shows a say until its ttl, then fades; a new say replaces the old one", () => {
    let s = reduceBuddy(initialBuddy(), { type: "say", text: "Hello" }, 1_000);
    expect(buddyView(s, 1_000 + SAY_TTL_MS - 1, { enabled: true, paused: false }).say).toBe("Hello");
    expect(buddyView(s, 1_000 + SAY_TTL_MS, { enabled: true, paused: false }).say).toBeNull();
    s = reduceBuddy(s, { type: "say", text: "One", ttl_ms: 2_000 }, 0);
    s = reduceBuddy(s, { type: "say", text: "Two", ttl_ms: 500 }, 100);
    expect(s.say).toEqual({ text: "Two", expiresAt: 600 });
    expect(expireBuddy(s, 600).say).toBeNull();
  });

  it("caps ttl_ms to 100..30000 and the say text to 280", () => {
    expect(clampTtl(1, 5)).toBe(TTL_MIN_MS);
    expect(clampTtl(10_000_000, 5)).toBe(TTL_MAX_MS);
    expect(clampTtl(undefined, 5)).toBe(5);
    expect(clampTtl(Number.NaN, 5)).toBe(5);
    const s = reduceBuddy(initialBuddy(), { type: "say", text: "x".repeat(400), ttl_ms: 1 }, 0);
    expect(s.say?.text).toHaveLength(280);
    expect(s.say?.expiresAt).toBe(TTL_MIN_MS);
  });

  it("glance flies to the rect and returns to the cursor after the pause", () => {
    const s = reduceBuddy(initialBuddy(), { type: "point", id: "g", rect, style: "glance" }, 0);
    expect(anchorOf(s, 0)).toEqual({ id: "g", rect });
    expect(anchorOf(s, FLY_MS + GLANCE_PAUSE_MS - 1)).toEqual({ id: "g", rect });
    expect(anchorOf(s, FLY_MS + GLANCE_PAUSE_MS)).toBeNull();
    expect(buddyView(s, 0, { enabled: true, paused: false }).halos).toEqual([]);
  });

  it("stop draws a halo and persists until buddy.clear; state changes do not cancel it", () => {
    let s = reduceBuddy(initialBuddy(), { type: "point", id: "s", rect, text: "Not this one", style: "stop" }, 0);
    s = reduceBuddy(s, { type: "state", state: "speaking" }, 10);
    const later = 24 * 3600 * 1000;
    expect(buddyView(s, later, { enabled: true, paused: false })).toMatchObject({
      target: { id: "s", rect, style: "stop" },
      halos: [{ id: "s", rect, text: "Not this one" }],
    });
    s = reduceBuddy(s, { type: "clear", id: "other" }, later);
    expect(s.stops).toHaveLength(1);
    s = reduceBuddy(s, { type: "clear", id: "s" }, later);
    expect(s.stops).toHaveLength(0);
    expect(anchorOf(s, later)).toBeNull();
  });

  it("a new point replaces an in-flight glance; same id replaces; one halo per id; clear without id clears all", () => {
    let s = run([
      [{ type: "point", id: "g", rect, style: "glance" }, 0],
      [{ type: "point", id: "a", rect, style: "stop" }, 100],
    ]);
    expect(s.glance).toBeNull();
    s = reduceBuddy(s, { type: "point", id: "a", rect: { ...rect, x: 0.5 }, style: "stop" }, 200);
    expect(s.stops).toHaveLength(1);
    expect(s.stops[0].rect.x).toBe(0.5);
    for (let i = 0; i < MAX_STOPS + 3; i++) s = reduceBuddy(s, { type: "point", id: `s${i}`, rect, style: "stop" }, 300 + i);
    expect(s.stops).toHaveLength(MAX_STOPS);
    s = reduceBuddy(s, { type: "say", text: "hi" }, 400);
    s = reduceBuddy(s, { type: "point", id: "g2", rect, style: "glance" }, 401);
    s = reduceBuddy(s, { type: "clear" }, 402);
    expect(s).toMatchObject({ say: null, glance: null, stops: [] });
  });

  it("overlay.halo maps to a 'stop' point and overlay.clear to clear", () => {
    const halo = parseClientMessage(JSON.stringify({ type: "overlay.halo", id: "h1", rect, text: "Stop" }));
    expect(halo.ok).toBe(true);
    if (!halo.ok) return;
    const action = toBuddyAction(halo.msg);
    expect(action).toEqual({ type: "point", id: "h1", rect, text: "Stop", style: "stop", ttl_ms: HALO_TTL_MS });
    const s = reduceBuddy(initialBuddy(), action as BuddyAction, 0);
    expect(buddyView(s, 0, { enabled: true, paused: false }).halos).toEqual([{ id: "h1", rect, text: "Stop" }]);
    const clear = parseClientMessage('{"type":"overlay.clear","id":"h1"}');
    expect(clear.ok && toBuddyAction(clear.msg)).toEqual({ type: "clear", id: "h1" });
    const ping = parseClientMessage('{"type":"ping"}');
    expect(ping.ok && toBuddyAction(ping.msg)).toBeNull();
  });

  it("halo-only rollback hides the buddy and say but keeps halos", () => {
    let s = reduceBuddy(initialBuddy(), { type: "point", id: "s", rect, style: "stop" }, 0);
    s = reduceBuddy(s, { type: "say", text: "hi" }, 0);
    expect(buddyView(s, 1, { enabled: false, paused: false })).toMatchObject({ buddy: false, say: null, target: null, halos: [{ id: "s" }] });
  });

  it("stops the cursor poll when hidden, paused, disabled or with nothing to follow", () => {
    const on = { enabled: true, visible: true, paused: false, paired: true, sayActive: false };
    expect(cursorPollNeeded(on)).toBe(true);
    expect(cursorPollNeeded({ ...on, visible: false })).toBe(false);
    expect(cursorPollNeeded({ ...on, paused: true })).toBe(false);
    expect(cursorPollNeeded({ ...on, enabled: false })).toBe(false);
    expect(cursorPollNeeded({ ...on, paired: false })).toBe(false);
    expect(cursorPollNeeded({ ...on, paired: false, sayActive: true })).toBe(true);
  });

  it("places the bubble off the cursor hotspot and inside the display", () => {
    expect(bubblePlacement({ x: 100, y: 100 }, { w: 200, h: 40 }, { w: 1000, h: 800 })).toEqual({ x: 114, y: 114 });
    expect(bubblePlacement({ x: 950, y: 790 }, { w: 200, h: 40 }, { w: 1000, h: 800 })).toEqual({ x: 736, y: 736 });
  });
});
