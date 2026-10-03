// In-memory throttle for POST /auth/verify (fix round T-0123): at most 10 attempts per email and 30 per IP in a
// sliding 10 minute window; a blocked attempt is not counted. Per server instance only (a serverless cold start
// resets it); Supabase's own verify rate limit still applies behind it.

export const VERIFY_WINDOW_MS = 10 * 60 * 1000;
export const VERIFY_MAX_PER_EMAIL = 10;
export const VERIFY_MAX_PER_IP = 30;
const SWEEP_AT = 10_000;

export type Throttle = {
  /** Records an attempt for key; false (not recorded) when the key is at its limit. */
  hit(key: string): boolean;
  reset(): void;
};

export function createThrottle({ limit, windowMs, now = () => Date.now() }: { limit: number; windowMs: number; now?: () => number }): Throttle {
  const hits = new Map<string, number[]>();
  return {
    hit(key) {
      const t = now();
      if (hits.size > SWEEP_AT) {
        for (const [k, v] of hits) if (v.every((x) => t - x >= windowMs)) hits.delete(k);
      }
      const recent = (hits.get(key) ?? []).filter((x) => t - x < windowMs);
      if (recent.length >= limit) {
        hits.set(key, recent);
        return false;
      }
      recent.push(t);
      hits.set(key, recent);
      return true;
    },
    reset() {
      hits.clear();
    },
  };
}

const emailThrottle = createThrottle({ limit: VERIFY_MAX_PER_EMAIL, windowMs: VERIFY_WINDOW_MS });
const ipThrottle = createThrottle({ limit: VERIFY_MAX_PER_IP, windowMs: VERIFY_WINDOW_MS });

export const verifyThrottle = {
  email: emailThrottle,
  ip: ipThrottle,
  reset() {
    emailThrottle.reset();
    ipThrottle.reset();
  },
};

/** The client IP as Vercel passes it (first x-forwarded-for entry, else x-real-ip); "unknown" when absent. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || headers.get("x-real-ip")?.trim() || "unknown";
}
