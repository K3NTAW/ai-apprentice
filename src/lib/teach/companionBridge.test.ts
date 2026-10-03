import { describe, expect, it, vi } from "vitest";
import type { ScreenEvent } from "@/lib/types";
import { routeShortcut } from "@/lib/companion/shortcuts";
import { EMAIL_FLOW_EVENTS, EMAIL_FLOW_WORKMAP } from "./fixtures";
import { createInterventionEngine } from "./intervention";
import { stopPointSink, teachShortcutControls } from "./companionBridge";
import { matchStep } from "./stepMatch";

const [open, amount, wrongCode, rightCode] = EMAIL_FLOW_EVENTS;

function engineWith(buddy: { buddyPoint: () => boolean; buddyClear: () => boolean }, enabled?: () => boolean) {
  const engine = createInterventionEngine({
    workmap: EMAIL_FLOW_WORKMAP,
    decide: async () => 0,
    companion: stopPointSink(() => buddy, enabled),
    onIntervene: () => {},
  });
  return (e: ScreenEvent) => engine.onEvent(e, matchStep(e, EMAIL_FLOW_WORKMAP));
}

describe("teach loop and the companion buddy", () => {
  it("an intervention sends a 'stop' point with the guardrail text and buddy.clear when resolved", async () => {
    const buddy = { buddyPoint: vi.fn(() => true), buddyClear: vi.fn(() => true) };
    const feed = engineWith(buddy);
    for (const e of [open, amount]) await feed(e);
    const iv = await feed(wrongCode);
    expect(iv?.halo).toBe(true);
    expect(buddy.buddyPoint).toHaveBeenCalledWith({
      id: iv!.id,
      rect: wrongCode.rect,
      style: "stop",
      text: `Sabine would stop here: ${iv!.quote}`,
    });
    expect(buddy.buddyClear).not.toHaveBeenCalled();
    await feed(rightCode);
    expect(buddy.buddyClear).toHaveBeenCalledWith(iv!.id);
  });

  it("not the whole monitor: no point, voice only", async () => {
    const buddy = { buddyPoint: vi.fn(() => true), buddyClear: vi.fn(() => true) };
    const feed = engineWith(buddy, () => false);
    for (const e of [open, amount]) await feed(e);
    const iv = await feed(wrongCode);
    expect(iv?.halo).toBe(false);
    expect(buddy.buddyPoint).not.toHaveBeenCalled();
  });

  it("shortcuts off_record_toggle and end_task call the existing controls; a young session confirms first", () => {
    const c = { talk: vi.fn(), togglePause: vi.fn(), finish: vi.fn(), startedAt: () => 1_000 };
    const controls = teachShortcutControls(c);
    const confirm = vi.fn(() => false);
    const at = (ms: number, ok = confirm) => ({ now: () => ms, confirm: ok });
    routeShortcut("off_record_toggle", controls, at(2_000));
    routeShortcut("pause_toggle", controls, at(2_000));
    expect(c.togglePause).toHaveBeenCalledTimes(2);
    routeShortcut("end_task", controls, at(2_000));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(c.finish).not.toHaveBeenCalled();
    routeShortcut("end_task", controls, at(2_000, vi.fn(() => true)));
    expect(c.finish).toHaveBeenCalledTimes(1);
    routeShortcut("end_task", controls, at(40_000));
    expect(confirm).toHaveBeenCalledTimes(1);
    expect(c.finish).toHaveBeenCalledTimes(2);
    routeShortcut("talk_start", controls, at(2_000));
    routeShortcut("talk_end", controls, at(2_000));
    expect(c.talk.mock.calls).toEqual([[true], [false]]);
  });

  it("shortcuts do nothing when no session runs", () => {
    const c = { talk: vi.fn(), togglePause: vi.fn(), finish: vi.fn(), startedAt: () => null };
    routeShortcut("end_task", teachShortcutControls(c), { confirm: () => true });
    routeShortcut("pause_toggle", teachShortcutControls(c), { confirm: () => true });
    expect(c.finish).not.toHaveBeenCalled();
    expect(c.togglePause).not.toHaveBeenCalled();
  });
});
