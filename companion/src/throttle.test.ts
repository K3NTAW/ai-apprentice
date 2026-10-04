import { describe, expect, it } from "vitest";
import { THROTTLE_GRACE_MS, ThrottleGate, voiceSessionActive, type TimeoutApi } from "./perf.mjs";
import { parseClientMessage } from "./protocol.mjs";

/** Fake timeouts with a clock: advance(ms) fires every timeout that is due. */
function fakeTimeouts() {
  const live = new Map<number, { fn: () => void; at: number }>();
  let id = 0;
  let now = 0;
  const api: TimeoutApi = {
    setTimeout: (fn, ms) => {
      live.set(++id, { fn, at: now + ms });
      return id;
    },
    clearTimeout: (h) => void live.delete(h as number),
  };
  function advance(ms: number) {
    now += ms;
    for (const [k, t] of [...live]) {
      if (t.at <= now) {
        live.delete(k);
        t.fn();
      }
    }
  }
  return { api, live, advance };
}

function gate() {
  const t = fakeTimeouts();
  const applied: boolean[] = [];
  const g = new ThrottleGate(t.api, (allow) => applied.push(allow));
  return { g, t, applied, last: () => applied[applied.length - 1] };
}

const base = { paired: true, mode: null, buddyMode: "idle", voiceActive: false } as const;

describe("voiceSessionActive", () => {
  it("is active during a voice session without capture/teach mode", () => {
    expect(voiceSessionActive(base)).toBe(false);
    expect(voiceSessionActive({ ...base, buddyMode: "listening" })).toBe(true);
    expect(voiceSessionActive({ ...base, buddyMode: "thinking" })).toBe(true);
    expect(voiceSessionActive({ ...base, buddyMode: "speaking" })).toBe(true);
    expect(voiceSessionActive({ ...base, voiceActive: true })).toBe(true);
  });

  it("is active in capture and teach, never without a page", () => {
    expect(voiceSessionActive({ ...base, mode: "capture" })).toBe(true);
    expect(voiceSessionActive({ ...base, mode: "teach" })).toBe(true);
    expect(voiceSessionActive({ ...base, paired: false, buddyMode: "speaking", voiceActive: true })).toBe(false);
  });
});

describe("ThrottleGate", () => {
  it("starts throttled and turns throttling off at once when voice starts", () => {
    const { g, last } = gate();
    expect(g.allowed).toBe(true);
    g.update(voiceSessionActive({ ...base, buddyMode: "listening" }));
    expect(g.allowed).toBe(false);
    expect(last()).toBe(false);
  });

  it("stays off through a debrief interview and returns 30 s after the last activity", () => {
    const { g, t, last } = gate();
    g.update(voiceSessionActive({ ...base, buddyMode: "speaking" }));
    // Between turns: idle, but still within the grace period.
    g.update(voiceSessionActive(base));
    t.advance(THROTTLE_GRACE_MS - 1);
    expect(g.allowed).toBe(false);
    // Activity again resets the 30 s.
    g.update(voiceSessionActive({ ...base, voiceActive: true }));
    t.advance(THROTTLE_GRACE_MS);
    expect(g.allowed).toBe(false);
    g.update(voiceSessionActive(base));
    t.advance(THROTTLE_GRACE_MS - 1);
    expect(g.allowed).toBe(false);
    t.advance(1);
    expect(g.allowed).toBe(true);
    expect(last()).toBe(true);
  });

  it("schedules one timer for repeated idle updates and cancel() drops it", () => {
    const { g, t } = gate();
    g.update(true);
    g.update(false);
    g.update(false);
    expect(t.live.size).toBe(1);
    g.cancel();
    expect(t.live.size).toBe(0);
  });
});

describe("session.state voice_active", () => {
  it("is optional and must be boolean", () => {
    const ok = parseClientMessage(JSON.stringify({ type: "session.state", mode: null, voice_active: true }));
    expect(ok.ok && ok.msg.type === "session.state" && ok.msg.voice_active).toBe(true);
    const absent = parseClientMessage(JSON.stringify({ type: "session.state", mode: null }));
    expect(absent.ok && absent.msg.type === "session.state" && "voice_active" in absent.msg).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: "session.state", mode: null, voice_active: "yes" }))).toEqual({ ok: false, reason: "session_voice_active" });
  });
});
