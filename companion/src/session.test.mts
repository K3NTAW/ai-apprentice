import { describe, expect, it } from "vitest";
import { parseAllowlist } from "./origin.mjs";
import { Pairing } from "./pairing.mjs";
import { CLOSE, DEFAULT_PORT } from "./protocol.mjs";
import {
  GLOBAL_COOLDOWN_MS,
  GLOBAL_MAX_FAILURES,
  LOCKOUT_WINDOW_MS,
  MAX_FAILED_ATTEMPTS,
  MAX_TRACKED_ORIGINS,
  OriginLockout,
  SessionGate,
} from "./session.mjs";

const HOST = `127.0.0.1:${DEFAULT_PORT}`;
const local = "http://localhost:3000";
const preview = "https://ai-apprentice-git-main.vercel.app";

function setup() {
  let n = 0;
  const pairing = new Pairing(() => String(100000 + n++));
  const clock = { now: 1_000_000 };
  const gate = new SessionGate(parseAllowlist(undefined), DEFAULT_PORT, pairing, () => clock.now);
  let id = 0;
  const attempt = (origin: string, token: string) => {
    const conn = ++id;
    const admitted = gate.admit(conn, { origin, host: HOST });
    if (!admitted.ok) return admitted;
    const r = gate.hello(conn, token);
    if (!r.ok) gate.close(conn);
    return r;
  };
  return { gate, pairing, clock, attempt };
}

describe("per-Origin pairing lockout", () => {
  it("closes each wrong code with 4401 and refuses the Origin with 4429 after 5 failures in 10 minutes", () => {
    const { attempt, clock } = setup();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) {
      expect(attempt(local, "000000")).toMatchObject({ ok: false, code: CLOSE.UNAUTHORIZED });
      clock.now += 60_000;
    }
    expect(attempt(local, "000000")).toMatchObject({ ok: false, code: CLOSE.LOCKED });
  });

  it("does not lock when failures are spread over more than the window", () => {
    const { attempt, clock } = setup();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS + 2; i++) {
      expect(attempt(local, "000000")).toMatchObject({ code: CLOSE.UNAUTHORIZED });
      clock.now += LOCKOUT_WINDOW_MS / 4;
    }
  });

  it("refuses the right code from a locked Origin but another Origin still pairs", () => {
    const { attempt, pairing } = setup();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) attempt(local, "000000");
    expect(attempt(local, pairing.current())).toMatchObject({ ok: false, code: CLOSE.LOCKED });
    expect(attempt(preview, pairing.current())).toEqual({ ok: true });
  });

  it("locks sockets of that Origin that were already pending", () => {
    const { gate, pairing, attempt } = setup();
    expect(gate.admit(500, { origin: local, host: HOST }).ok).toBe(true);
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) attempt(local, "000000");
    expect(gate.hello(500, pairing.current())).toMatchObject({ ok: false, code: CLOSE.LOCKED });
  });

  it("never changes the displayed code because of failures", () => {
    const { attempt, pairing } = setup();
    const shown = pairing.current();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS + 3; i++) attempt(local, "000000");
    expect(pairing.current()).toBe(shown);
    expect(attempt(preview, shown)).toEqual({ ok: true });
  });

  it("rotates the code after a successful pairing", () => {
    const { gate, attempt, pairing } = setup();
    const shown = pairing.current();
    expect(attempt(local, shown)).toEqual({ ok: true });
    expect(pairing.current()).not.toBe(shown);
    gate.close(gate.pairedId()!);
    expect(attempt(local, shown)).toMatchObject({ code: CLOSE.UNAUTHORIZED });
  });

  it("lets the lock expire once the window has passed", () => {
    const { attempt, clock, pairing } = setup();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) attempt(local, "000000");
    clock.now += LOCKOUT_WINDOW_MS - 1;
    expect(attempt(local, pairing.current())).toMatchObject({ code: CLOSE.LOCKED });
    clock.now += 1;
    expect(attempt(local, pairing.current())).toEqual({ ok: true });
  });
});

const fabricated = (i: number) => `https://ai-apprentice-probe${i}.vercel.app`;

describe("global pairing budget across Origins", () => {
  it("refuses the 21st hello with 4429 for 60 s after 20 failures across many Origins, then pairs", () => {
    const { attempt, clock, pairing } = setup();
    const shown = pairing.current();
    for (let i = 0; i < GLOBAL_MAX_FAILURES; i++) {
      expect(attempt(fabricated(i), "000000")).toMatchObject({ ok: false, code: CLOSE.UNAUTHORIZED });
      clock.now += 1_000;
    }
    // Fresh Origins and the right code are refused too.
    expect(attempt(fabricated(999), shown)).toMatchObject({ ok: false, code: CLOSE.LOCKED });
    expect(attempt(local, shown)).toMatchObject({ ok: false, code: CLOSE.LOCKED });
    clock.now += GLOBAL_COOLDOWN_MS - 1;
    expect(attempt(local, shown)).toMatchObject({ ok: false, code: CLOSE.LOCKED });
    expect(pairing.current()).toBe(shown);
    clock.now += 1;
    expect(attempt(local, shown)).toEqual({ ok: true });
  });

  it("refuses a socket that was already pending when the budget ran out", () => {
    const { gate, attempt, pairing } = setup();
    expect(gate.admit(500, { origin: local, host: HOST }).ok).toBe(true);
    for (let i = 0; i < GLOBAL_MAX_FAILURES; i++) attempt(fabricated(i), "000000");
    expect(gate.hello(500, pairing.current())).toMatchObject({ ok: false, code: CLOSE.LOCKED });
  });

  it("does not trip when 20 failures are spread over more than 10 minutes", () => {
    const { attempt, clock, pairing } = setup();
    for (let i = 0; i < GLOBAL_MAX_FAILURES; i++) {
      expect(attempt(fabricated(i), "000000")).toMatchObject({ code: CLOSE.UNAUTHORIZED });
      clock.now += LOCKOUT_WINDOW_MS / (GLOBAL_MAX_FAILURES - 2);
    }
    expect(attempt(local, pairing.current())).toEqual({ ok: true });
  });
});

describe("failure map sweep and cap", () => {
  it("sweeps expired Origins on every recordFailure", () => {
    const lockout = new OriginLockout();
    for (let i = 0; i < 10; i++) lockout.recordFailure(fabricated(i), 0);
    expect(lockout.size).toBe(10);
    lockout.recordFailure(local, LOCKOUT_WINDOW_MS);
    expect(lockout.size).toBe(1);
  });

  it("caps the map at 256 Origins and evicts the oldest", () => {
    const lockout = new OriginLockout();
    for (let i = 0; i < MAX_FAILED_ATTEMPTS; i++) lockout.recordFailure(local, i);
    expect(lockout.isLocked(local, 10)).toBe(true);
    for (let i = 0; i < MAX_TRACKED_ORIGINS + 50; i++) lockout.recordFailure(fabricated(i), 100 + i);
    expect(lockout.size).toBe(MAX_TRACKED_ORIGINS);
    // local had the oldest failure, so it was evicted first.
    expect(lockout.isLocked(local, 1_000)).toBe(false);
    expect(lockout.isLocked(fabricated(MAX_TRACKED_ORIGINS + 49), 1_000)).toBe(false);
    expect(lockout.size).toBe(MAX_TRACKED_ORIGINS);
  });
});
