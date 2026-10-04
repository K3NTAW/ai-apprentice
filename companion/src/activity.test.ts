import { describe, expect, it } from "vitest";
import { ActivityAggregator, AppChangeTracker, toInputKind } from "./activity.mjs";

const ACTIVITY_KEYS = ["clicks", "idle_ms", "keys", "pointer", "t", "type", "typing"];

// Synthetic uiohook-like events WITH sensitive payload fields; the adapter must drop them.
type Raw = { name: string; t: number; payload: Record<string, unknown> };
const keyEv = (t: number): Raw => ({ name: "keydown", t, payload: { keycode: 30, rawcode: 0x41, keychar: "a", char: "a", x: 0, y: 0 } });
const moveEv = (t: number): Raw => ({ name: "mousemove", t, payload: { x: 812, y: 433 } });
const clickEv = (t: number): Raw => ({ name: "mousedown", t, payload: { x: 10, y: 20, button: 1, clicks: 1 } });
const upEv = (t: number): Raw => ({ name: "keyup", t, payload: { keycode: 30 } });

function feed(agg: ActivityAggregator, events: Raw[]) {
  for (const e of events) {
    const kind = toInputKind(e.name, e.payload);
    if (kind) agg.record(kind, e.t);
  }
}

describe("activity aggregation", () => {
  it("aggregates a 500 ms window into counts", () => {
    const agg = new ActivityAggregator(0);
    feed(agg, [keyEv(10), keyEv(50), upEv(60), keyEv(120), moveEv(200), clickEv(300)]);
    expect(agg.flush(500)).toEqual({ type: "activity", t: 500, typing: true, pointer: true, keys: 3, clicks: 1, idle_ms: 200 });
  });

  it("resets counts per window and grows idle_ms", () => {
    const agg = new ActivityAggregator(0);
    feed(agg, [moveEv(100)]);
    expect(agg.flush(500)).toMatchObject({ typing: false, pointer: true, keys: 0, clicks: 0, idle_ms: 400 });
    expect(agg.flush(1000)).toEqual({ type: "activity", t: 1000, typing: false, pointer: false, keys: 0, clicks: 0, idle_ms: 900 });
  });

  it("counts idle from start when nothing happened and after reset", () => {
    const agg = new ActivityAggregator(1000);
    expect(agg.flush(1500).idle_ms).toBe(500);
    feed(agg, [keyEv(1600)]);
    agg.reset(2000);
    expect(agg.flush(2500)).toMatchObject({ keys: 0, typing: false, idle_ms: 500 });
  });

  it("ignores unknown events and never leaks key codes, characters or positions", () => {
    const agg = new ActivityAggregator(0);
    const outputs: object[] = [];
    let t = 0;
    for (let w = 0; w < 6; w++) {
      feed(agg, [keyEv(t + 1), keyEv(t + 2), moveEv(t + 3), clickEv(t + 4), upEv(t + 5), { name: "constructor", t, payload: {} }]);
      t += 500;
      outputs.push(agg.flush(t));
    }
    for (const msg of outputs) {
      expect(Object.keys(msg).sort()).toEqual(ACTIVITY_KEYS);
      const json = JSON.stringify(msg);
      for (const forbidden of ["keycode", "rawcode", "keychar", "char", '"x"', '"y"', "button", "812", "433", '"a"']) {
        expect(json).not.toContain(forbidden);
      }
      for (const [k, v] of Object.entries(msg)) {
        if (k === "type") expect(v).toBe("activity");
        else expect(["number", "boolean"]).toContain(typeof v);
      }
    }
    expect(outputs[0]).toMatchObject({ keys: 2, clicks: 1 });
  });

  it("adapter returns only the kind", () => {
    expect(toInputKind("keydown", { keycode: 1 })).toBe("key");
    expect(toInputKind("mousedown", { x: 1 })).toBe("click");
    expect(toInputKind("mousemove")).toBe("move");
    expect(toInputKind("wheel")).toBe("wheel");
    expect(toInputKind("keyup")).toBeNull();
    expect(toInputKind("toString")).toBeNull();
  });
});

describe("app change tracker", () => {
  it("emits only on change", () => {
    const tr = new AppChangeTracker();
    expect(tr.changed("Microsoft Outlook", "Inbox")).toBe(true);
    expect(tr.changed("Microsoft Outlook", "Inbox")).toBe(false);
    expect(tr.changed("Microsoft Outlook", "Re: offer")).toBe(true);
    expect(tr.changed("Excel", "Re: offer")).toBe(true);
    tr.reset();
    expect(tr.changed("Excel", "Re: offer")).toBe(true);
  });
});
