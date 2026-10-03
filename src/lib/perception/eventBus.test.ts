import { describe, expect, it } from "vitest";
import type { ScreenEvent, VisionEvent } from "@/lib/types";
import { createEventBus } from "./eventBus";

const change: VisionEvent = {
  type: "field_changed",
  entity: { kind: "invoice", id: "INV-1" },
  field: "cost_center",
  from: "100",
  to: "200",
};

describe("event bus", () => {
  it("publishes DOM events with id, t and source", () => {
    const bus = createEventBus();
    const ev = bus.publishDom(change, 3)!;
    expect(ev).toMatchObject({ source: "dom", t: 3, field: "cost_center" });
    expect(ev.id).toMatch(/^ev_/);
    expect(bus.all()).toEqual([ev]);
  });

  it("drops a vision event when a DOM twin exists within 4 s", () => {
    const bus = createEventBus();
    bus.publishDom(change, 10);
    expect(bus.publishVision([change], 13)).toEqual([]);
    expect(bus.publishVision([change], 6)).toEqual([]);
    expect(bus.publishVision([{ ...change, field: "amount" }], 12)).toHaveLength(1);
    expect(bus.publishVision([change], 20)).toHaveLength(1);
  });

  it("a later DOM event replaces its earlier vision twin", () => {
    const bus = createEventBus();
    const seen: [ScreenEvent, string | undefined][] = [];
    bus.subscribe((e, replaces) => seen.push([e, replaces]));
    const [v] = bus.publishVision([change], 5, "frames/0005.jpg");
    expect(v.frame_ref).toBe("frames/0005.jpg");
    const d = bus.publishDom(change, 7)!;
    expect(bus.all()).toEqual([d]);
    expect(seen.map(([e]) => e.source)).toEqual(["vision", "dom"]);
    expect(seen[1][1]).toBe(v.id);
  });

  it("drops identical consecutive vision events within 10 s", () => {
    const bus = createEventBus();
    expect(bus.publishVision([change, change], 1)).toHaveLength(1);
    expect(bus.publishVision([change], 9)).toEqual([]);
    expect(bus.publishVision([{ ...change, to: "300" }], 9)).toHaveLength(1);
    expect(bus.publishVision([change], 12)).toHaveLength(1);
  });

  it("paused bus stores and emits nothing", () => {
    const bus = createEventBus();
    let calls = 0;
    bus.subscribe(() => calls++);
    bus.setPaused(true);
    expect(bus.publishDom(change, 1)).toBeUndefined();
    expect(bus.publishVision([change], 2)).toEqual([]);
    expect(bus.all()).toEqual([]);
    expect(calls).toBe(0);
    bus.setPaused(false);
    bus.publishDom(change, 3);
    expect(calls).toBe(1);
  });

  it("unsubscribe stops delivery", () => {
    const bus = createEventBus();
    let calls = 0;
    const off = bus.subscribe(() => calls++);
    off();
    bus.publishDom(change, 1);
    expect(calls).toBe(0);
  });
});
