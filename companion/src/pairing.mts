// Pairing codes: crypto.randomInt, length-safe constant-time compare. Failed attempts are
// counted per Origin in session.mts, so failures never rotate the displayed code.
import { createHash, randomInt, timingSafeEqual } from "node:crypto";

export const CODE_LENGTH = 6;

export function generateCode(): string {
  return String(randomInt(0, 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
}

/** Constant-time compare that is safe for inputs of different length (both sides hashed first). */
export function codesEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a, "utf8").digest();
  const hb = createHash("sha256").update(b, "utf8").digest();
  return timingSafeEqual(ha, hb) && a.length === b.length;
}

export class Pairing {
  private code: string;
  constructor(
    private readonly gen: () => string = generateCode,
    private readonly onRotate: (code: string) => void = () => {},
  ) {
    this.code = gen();
  }

  current(): string {
    return this.code;
  }

  /** New code: only on 'New pairing code' or after a successful pairing. */
  rotate(): string {
    this.code = this.gen();
    this.onRotate(this.code);
    return this.code;
  }

  check(token: string): boolean {
    return /^\d{6}$/.test(token) && codesEqual(token, this.code);
  }
}
