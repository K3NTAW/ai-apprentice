import { describe, expect, it } from "vitest";
import type { VisionEvent } from "@/lib/types";
import { createEventBus } from "./eventBus";

const change: VisionEvent = {
  type: "field_changed",
  entity: { kind: "invoice", id: "INV-1" },
  field: "cost_center",
  from: "100",
  to: "200",
};

describe("event bus", () => {
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
    expect(bus.publishOs(change, 1)).toBeUndefined();
    expect(bus.publishVision([change], 2)).toEqual([]);
    expect(bus.all()).toEqual([]);
    expect(calls).toBe(0);
    bus.setPaused(false);
    bus.publishOs(change, 3);
    expect(calls).toBe(1);
  });

  it("unsubscribe stops delivery", () => {
    const bus = createEventBus();
    let calls = 0;
    const off = bus.subscribe(() => calls++);
    off();
    bus.publishOs(change, 1);
    expect(calls).toBe(0);
  });
});

describe("os events", () => {
  const sw = { type: "app_switched" as const, entity: { kind: "app", id: "Microsoft Outlook" }, app: "Microsoft Outlook" };

  it("an os app_switched within 1 s replaces the vision twin", () => {
    const bus = createEventBus({ now: () => 0 });
    const [v] = bus.publishVision([sw], 10);
    const seen: (string | undefined)[] = [];
    bus.subscribe((_e, replaces) => seen.push(replaces));
    const os = bus.publishOs(sw, 10.6)!;
    expect(os.source).toBe("os");
    expect(seen).toEqual([v.id]);
    expect(bus.all().map((e) => e.source)).toEqual(["os"]);
  });

  it("a vision app_switched within 1 s of an os one is dropped; later ones are kept", () => {
    const bus = createEventBus({ now: () => 0 });
    bus.publishOs(sw, 10);
    expect(bus.publishVision([sw], 10.8)).toEqual([]);
    expect(bus.publishVision([sw], 12)).toHaveLength(1);
  });
});
