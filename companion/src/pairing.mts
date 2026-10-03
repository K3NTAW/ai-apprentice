// Pairing codes: crypto.randomInt, length-safe constant-time compare, lockout by rotation.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_LENGTH = 6;
export const MAX_FAILED_ATTEMPTS = 5;

export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/** Constant-time compare that is safe for inputs of different length (both sides hashed first). */
export function codesEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export type PairingCheck = "ok" | "bad" | "locked";

export class Pairing {
  private code: string;
  private failures = 0;
  constructor(
    private readonly gen: () => string = generateCode,
    private readonly onRotate: (code: string) => void = () => {},
  ) {
    this.code = gen();
  }

  current(): string {
    return this.code;
  }

  rotate(): string {
    this.code = this.gen();
    this.failures = 0;
    this.onRotate(this.code);
    return this.code;
  }

  /** Check a token. After MAX_FAILED_ATTEMPTS wrong tokens the code is rotated and 'locked' returned. */
  check(token: string): PairingCheck {
    const ok = /^\d{6}$/.test(token) && codesEqual(token, this.code);
    if (ok) {
      this.failures = 0;
      return "ok";
    }
    this.failures += 1;
    if (this.failures >= MAX_FAILED_ATTEMPTS) {
      this.rotate();
      return "locked";
    }
    return "bad";
  }
}
