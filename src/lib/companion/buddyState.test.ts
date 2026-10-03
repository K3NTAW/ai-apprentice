import { describe, expect, it } from "vitest";
import { buddyStateFor, type BuddyInput } from "./buddyState";

const base: BuddyInput = { active: true, paused: false, voiceStatus: "connected", mode: "listening", pending: 0 };

describe("buddy state", () => {
  it("maps agent mode and pending work", () => {
    expect(buddyStateFor(base)).toBe("listening");
    expect(buddyStateFor({ ...base, mode: "speaking" })).toBe("speaking");
    expect(buddyStateFor({ ...base, pending: 1 })).toBe("thinking");
    expect(buddyStateFor({ ...base, mode: "speaking", pending: 2 })).toBe("speaking");
  });

  it("off the record or paused wins; nothing running is idle", () => {
    expect(buddyStateFor({ ...base, paused: true, mode: "speaking", pending: 1 })).toBe("paused");
    expect(buddyStateFor({ ...base, active: false, mode: "speaking" })).toBe("idle");
  });

  it("text mode: idle unless waiting; push-to-talk listens", () => {
    const text = { ...base, voiceStatus: "disconnected", mode: null };
    expect(buddyStateFor(text)).toBe("idle");
    expect(buddyStateFor({ ...text, pending: 1 })).toBe("thinking");
    expect(buddyStateFor({ ...text, pending: 1, talking: true })).toBe("listening");
  });
});
