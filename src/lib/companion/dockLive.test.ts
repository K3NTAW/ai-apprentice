// T-0240: protocol v4 messages from the page: dock.now (live line, <= 120 chars, app <= 64) and dock.ack (<= 40 chars).
import { describe, expect, it } from "vitest";
import { DOCK_ACK_MAX, DOCK_NOW_MAX, outgoing } from "./client";
import { createNoneTransport } from "./transport";

describe("dock.now and dock.ack (page side)", () => {
  it("dock.now clips text and app; empty text clears without an app", () => {
    expect(outgoing.dockNow("changed  cost center\n4711 to 0400", "Excel")).toEqual({ type: "dock.now", text: "changed cost center 4711 to 0400", app: "Excel" });
    expect((outgoing.dockNow("x".repeat(500)).text as string).length).toBe(DOCK_NOW_MAX);
    expect(outgoing.dockNow("", "Excel")).toEqual({ type: "dock.now", text: "" });
  });

  it("dock.ack clips to 40 chars and drops empty text", () => {
    expect(outgoing.dockAck("got it")).toEqual({ type: "dock.ack", text: "got it" });
    expect((outgoing.dockAck("y".repeat(99))!.text as string).length).toBe(DOCK_ACK_MAX);
    expect(outgoing.dockAck("  ")).toBeNull();
  });

  it("without a companion both are no-ops", () => {
    const t = createNoneTransport();
    expect(t.dockNow("x")).toBe(false);
    expect(t.dockAck("got it")).toBe(false);
  });
});
