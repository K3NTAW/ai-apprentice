// Admission and pairing state machine. Pure: the ws glue in server.mts calls into it.
// Rules:
// - Origin must match the allowlist and Host must be loopback on our port, else 4403.
// - While a client is paired, new connections are closed 4409 (one client at a time).
// - Unauthenticated (pending) sockets do not count as the paired client, but at most
//   MAX_PENDING may wait for hello at once; extra ones are closed 4409.
// - The first message must be a valid hello with the current code, else 4401.
//   Each wrong code is counted against the connection's Origin. After MAX_FAILED_ATTEMPTS
//   failures from one Origin within LOCKOUT_WINDOW_MS, that Origin is refused with 4429 until
//   its failures age out of the window. Failures never rotate the displayed code; it rotates
//   only on 'New pairing code' or after a successful pairing.
// - Global budget on top of the per-Origin lockout: at most GLOBAL_MAX_FAILURES failed hellos across
//   all Origins within LOCKOUT_WINDOW_MS. Reaching it refuses every connection and hello with 4429 for
//   GLOBAL_COOLDOWN_MS, then the budget starts over. Arithmetic: an attacker rotating Origins gets at
//   most 20 guesses per ~70 s (20 fast tries + 60 s cooldown), about 25k guesses per day. A 6-digit
//   code has 10^6 values, so the expected 500k guesses take ~20 days and the full space ~40 days:
//   weeks, while the code still rotates on every successful pairing or 'New pairing code'.
// - The per-Origin failure map is swept of expired entries on every failure and capped at
//   MAX_TRACKED_ORIGINS (the Origin whose last failure is oldest is evicted).
// - No hello within HELLO_TIMEOUT_MS: 4408.
import { isHostAllowed, isOriginAllowed, type Allowlist } from "./origin.mjs";
import type { Pairing } from "./pairing.mjs";
import { CLOSE } from "./protocol.mjs";

export const HELLO_TIMEOUT_MS = 5_000;
export const MAX_PENDING = 4;
export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_WINDOW_MS = 10 * 60_000;
export const GLOBAL_MAX_FAILURES = 20;
export const GLOBAL_COOLDOWN_MS = 60_000;
export const MAX_TRACKED_ORIGINS = 256;

/** Failed hellos per Origin in a sliding window. */
export class OriginLockout {
  private failures = new Map<string, number[]>();

  constructor(
    private readonly max = MAX_FAILED_ATTEMPTS,
    private readonly windowMs = LOCKOUT_WINDOW_MS,
    private readonly cap = MAX_TRACKED_ORIGINS,
  ) {}

  /** Number of Origins with failures still tracked. */
  get size(): number {
    return this.failures.size;
  }

  private recent(origin: string, now: number): number[] {
    const list = (this.failures.get(origin) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length) this.failures.set(origin, list);
    else this.failures.delete(origin);
    return list;
  }

  isLocked(origin: string, now: number): boolean {
    return this.recent(origin, now).length >= this.max;
  }

  recordFailure(origin: string, now: number): void {
    for (const key of [...this.failures.keys()]) this.recent(key, now);
    const list = [...(this.failures.get(origin) ?? []), now];
    // Re-insert so Map order is by last failure; the first key is the oldest.
    this.failures.delete(origin);
    this.failures.set(origin, list);
    while (this.failures.size > this.cap) {
      const oldest = this.failures.keys().next().value as string;
      this.failures.delete(oldest);
    }
  }
}

/** Failed hellos across all Origins; reaching the max refuses everything for a cooldown. */
export class GlobalBudget {
  private failures: number[] = [];
  private lockedUntil = 0;

  constructor(
    private readonly max = GLOBAL_MAX_FAILURES,
    private readonly windowMs = LOCKOUT_WINDOW_MS,
    private readonly cooldownMs = GLOBAL_COOLDOWN_MS,
  ) {}

  isLocked(now: number): boolean {
    return now < this.lockedUntil;
  }

  recordFailure(now: number): void {
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
    this.failures.push(now);
    if (this.failures.length >= this.max) {
      this.lockedUntil = now + this.cooldownMs;
      this.failures = [];
    }
  }
}

export type Decision = { ok: true } | { ok: false; code: number; reason: string };

export class SessionGate {
  /** Pending connection id -> its Origin. */
  private pending = new Map<number, string>();
  private paired: number | null = null;
  private readonly lockout = new OriginLockout();
  private readonly budget = new GlobalBudget();

  constructor(
    private readonly allowlist: Allowlist,
    private readonly port: number,
    private readonly pairing: Pairing,
    private readonly now: () => number = Date.now,
  ) {}

  /** Called on upgrade. On ok, the connection is registered as pending under id. */
  admit(id: number, headers: { origin?: string; host?: string }): Decision {
    if (!isOriginAllowed(headers.origin, this.allowlist)) return { ok: false, code: CLOSE.FORBIDDEN, reason: "origin" };
    if (!isHostAllowed(headers.host, this.port)) return { ok: false, code: CLOSE.FORBIDDEN, reason: "host" };
    const origin = headers.origin as string;
    if (this.budget.isLocked(this.now())) return { ok: false, code: CLOSE.LOCKED, reason: "global_locked" };
    if (this.lockout.isLocked(origin, this.now())) return { ok: false, code: CLOSE.LOCKED, reason: "locked" };
    if (this.paired !== null) return { ok: false, code: CLOSE.BUSY, reason: "busy" };
    if (this.pending.size >= MAX_PENDING) return { ok: false, code: CLOSE.BUSY, reason: "too_many_pending" };
    this.pending.set(id, origin);
    return { ok: true };
  }

  /** Handle the first message token of a pending connection. */
  hello(id: number, token: string): Decision {
    const origin = this.pending.get(id);
    if (origin === undefined) return { ok: false, code: CLOSE.UNAUTHORIZED, reason: "not_pending" };
    if (this.paired !== null) return { ok: false, code: CLOSE.BUSY, reason: "busy" };
    const now = this.now();
    // Sockets already pending when their Origin or the global budget got locked do not get extra attempts.
    if (this.budget.isLocked(now)) return { ok: false, code: CLOSE.LOCKED, reason: "global_locked" };
    if (this.lockout.isLocked(origin, now)) return { ok: false, code: CLOSE.LOCKED, reason: "locked" };
    if (!this.pairing.check(token)) {
      this.lockout.recordFailure(origin, now);
      this.budget.recordFailure(now);
      return { ok: false, code: CLOSE.UNAUTHORIZED, reason: "bad_code" };
    }
    this.pending.delete(id);
    this.paired = id;
    this.pairing.rotate();
    return { ok: true };
  }

  isPending(id: number): boolean {
    return this.pending.has(id);
  }

  isPaired(id: number): boolean {
    return this.paired === id;
  }

  pairedId(): number | null {
    return this.paired;
  }

  /** Forget a connection. Returns true if it was the paired client. */
  close(id: number): boolean {
    this.pending.delete(id);
    if (this.paired === id) {
      this.paired = null;
      return true;
    }
    return false;
  }
}
