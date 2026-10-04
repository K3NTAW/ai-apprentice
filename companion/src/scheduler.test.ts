import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { overlayShown } from "./perf.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (f: string) => fs.readFileSync(path.join(here, "..", "static", f), "utf8");

type Scheduler = { wake(): void; running(): boolean };
type Api = { createScheduler(raf: (cb: (now: number) => void) => void, step: (now: number) => boolean): Scheduler; settled(p: object | null, g: object | null): boolean };

await import("../static/scheduler.js");
const api = (globalThis as unknown as { companionScheduler: Api }).companionScheduler;

/** Fake rAF: frames run only when flush() is called. */
function fakeRaf() {
  let queue: ((now: number) => void)[] = [];
  let t = 0;
  return {
    raf: (cb: (now: number) => void) => queue.push(cb),
    pending: () => queue.length,
    flush(n = 1) {
      for (let i = 0; i < n && queue.length; i++) {
        const q = queue;
        queue = [];
        t += 16;
        for (const cb of q) cb(t);
      }
    },
  };
}

describe("overlay animation scheduler", () => {
  it("stops when nothing animates", () => {
    const r = fakeRaf();
    let frames = 0;
    let moving = 3;
    const s = api.createScheduler(r.raf, () => {
      frames++;
      return --moving > 0;
    });
    s.wake();
    r.flush(10);
    expect(frames).toBe(3);
    expect(r.pending()).toBe(0);
    expect(s.running()).toBe(false);
  });

  it("restarts on a new buddy.point or halo (onView wakes the loop)", () => {
    const r = fakeRaf();
    let frames = 0;
    const s = api.createScheduler(r.raf, () => {
      frames++;
      return false;
    });
    s.wake();
    r.flush(5);
    expect(frames).toBe(1);
    expect(r.pending()).toBe(0);
    s.wake();
    expect(r.pending()).toBe(1);
    r.flush(5);
    expect(frames).toBe(2);
  });

  it("wake while queued requests one frame only", () => {
    const r = fakeRaf();
    const s = api.createScheduler(r.raf, () => false);
    s.wake();
    s.wake();
    s.wake();
    expect(r.pending()).toBe(1);
  });

  it("settled within half a pixel", () => {
    expect(api.settled({ x: 10, y: 10 }, { x: 10.3, y: 9.8 })).toBe(true);
    expect(api.settled({ x: 10, y: 10 }, { x: 12, y: 10 })).toBe(false);
    expect(api.settled(null, { x: 1, y: 1 })).toBe(true);
  });

  it("overlay.js uses the scheduler and wakes it on view and cursor, never re-queues unconditionally", () => {
    const js = read("overlay.js");
    expect(js).not.toContain("requestAnimationFrame(frame)");
    expect(js).toContain("sched.createScheduler(");
    expect(js.match(/loop\.wake\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    const html = read("overlay.html");
    expect(html.indexOf("scheduler.js")).toBeGreaterThan(-1);
    expect(html.indexOf("scheduler.js")).toBeLessThan(html.indexOf("overlay.js"));
  });
});

describe("overlay window visibility", () => {
  const base = { mode: "teach" as const, buddy: true, follow: true, target: false, halos: 0 };
  it("hidden when empty", () => {
    expect(overlayShown({ ...base, buddy: false })).toBe(false);
    expect(overlayShown({ ...base, follow: false })).toBe(false);
    expect(overlayShown({ ...base, mode: null, buddy: false, follow: false })).toBe(false);
  });
  it("hidden in capture mode", () => {
    expect(overlayShown({ ...base, mode: "capture" })).toBe(false);
    expect(overlayShown({ ...base, mode: "capture", halos: 2, target: true })).toBe(false);
  });
  it("shown for a visible buddy, a target or halos", () => {
    expect(overlayShown(base)).toBe(true);
    expect(overlayShown({ ...base, follow: false, target: true })).toBe(true);
    expect(overlayShown({ ...base, buddy: false, follow: false, halos: 1 })).toBe(true);
  });
});
