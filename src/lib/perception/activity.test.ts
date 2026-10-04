import { describe, expect, it } from "vitest";
import { createActivityTracker } from "./activity";

function setup() {
  let t = 0;
  const tracker = createActivityTracker({ now: () => t });
  return { tracker, advance: (ms: number) => (t += ms) };
}

describe("activity tracker", () => {
  it("typing within 1500 ms of a keystroke", () => {
    const { tracker, advance } = setup();
    tracker.noteKeystroke();
    advance(1000);
    expect(tracker.snapshot()).toMatchObject({ typing: true, reading: false, silence_ms: 1000 });
    advance(600);
    expect(tracker.snapshot().typing).toBe(false);
  });

  it("reading when no typing but the frame changed or pointer moved within 4000 ms", () => {
    const { tracker, advance } = setup();
    tracker.noteKeystroke();
    advance(2000);
    tracker.noteFrameChange();
    advance(1000);
    expect(tracker.snapshot()).toMatchObject({ typing: false, reading: true, silence_ms: 1000 });
    advance(3500);
    expect(tracker.snapshot().reading).toBe(false);
    tracker.notePointer();
    expect(tracker.snapshot().reading).toBe(true);
  });

  it("silence counts from speech end and is 0 while speaking", () => {
    const { tracker, advance } = setup();
    advance(5000);
    expect(tracker.snapshot().silence_ms).toBe(5000);
    tracker.noteSpeech(true);
    advance(2000);
    expect(tracker.snapshot()).toMatchObject({ speaking: true, silence_ms: 0 });
    tracker.noteSpeech(false);
    advance(700);
    expect(tracker.snapshot()).toMatchObject({ speaking: false, silence_ms: 700 });
  });

  it("pointer moves do not reset silence", () => {
    const { tracker, advance } = setup();
    tracker.noteKeystroke();
    advance(3000);
    tracker.notePointer();
    expect(tracker.snapshot().silence_ms).toBe(3000);
  });
});
