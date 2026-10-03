// Admission and pairing state machine. Pure: the ws glue in server.mts calls into it.
// Rules:
// - Origin must match the allowlist and Host must be loopback on our port, else 4403.
// - While a client is paired, new connections are closed 4409 (one client at a time).
// - Unauthenticated (pending) sockets do not count as the paired client, but at most
//   MAX_PENDING may wait for hello at once; extra ones are closed 4409.
// - The first message must be a valid hello with the current code, else 4401.
//   After MAX_FAILED_ATTEMPTS wrong codes the code rotates and the socket is closed 4429.
// - No hello within HELLO_TIMEOUT_MS: 4408.
import { isHostAllowed, isOriginAllowed, type Allowlist } from "./origin.mjs";
import type { Pairing } from "./pairing.mjs";
import { CLOSE } from "./protocol.mjs";

export const HELLO_TIMEOUT_MS = 5_000;
export const MAX_PENDING = 4;

export type Decision = { ok: true } | { ok: false; code: number; reason: string };

export class SessionGate {
  private pending = new Set<number>();
  private paired: number | null = null;

  constructor(
    private readonly allowlist: Allowlist,
    private readonly port: number,
    private readonly pairing: Pairing,
  ) {}

  /** Called on upgrade. On ok, the connection is registered as pending under id. */
  admit(id: number, headers: { origin?: string; host?: string }): Decision {
    if (!isOriginAllowed(headers.origin, this.allowlist)) return { ok: false, code: CLOSE.FORBIDDEN, reason: "origin" };
    if (!isHostAllowed(headers.host, this.port)) return { ok: false, code: CLOSE.FORBIDDEN, reason: "host" };
    if (this.paired !== null) return { ok: false, code: CLOSE.BUSY, reason: "busy" };
    if (this.pending.size >= MAX_PENDING) return { ok: false, code: CLOSE.BUSY, reason: "too_many_pending" };
    this.pending.add(id);
    return { ok: true };
  }

  /** Handle the first message token of a pending connection. */
  hello(id: number, token: string): Decision {
    if (!this.pending.has(id)) return { ok: false, code: CLOSE.UNAUTHORIZED, reason: "not_pending" };
    if (this.paired !== null) return { ok: false, code: CLOSE.BUSY, reason: "busy" };
    const r = this.pairing.check(token);
    if (r === "locked") return { ok: false, code: CLOSE.LOCKED, reason: "locked" };
    if (r === "bad") return { ok: false, code: CLOSE.UNAUTHORIZED, reason: "bad_code" };
    this.pending.delete(id);
    this.paired = id;
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
