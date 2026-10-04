// In-memory throttle (sliding window; a blocked attempt is not counted). Per server instance only (a serverless
// cold start resets it); Supabase's own Auth rate limits still apply behind it. Used by POST /api/auth/bootstrap.

export const BOOTSTRAP_WINDOW_MS = 10 * 60 * 1000;
export const BOOTSTRAP_MAX_PER_IP = 30;
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

/** POST /api/auth/bootstrap: at most 30 calls per IP in 10 minutes, then 429. */
export const bootstrapThrottle = createThrottle({ limit: BOOTSTRAP_MAX_PER_IP, windowMs: BOOTSTRAP_WINDOW_MS });

/** The client IP as Vercel passes it (first x-forwarded-for entry, else x-real-ip); "unknown" when absent. */
export function clientIp(headers: Headers): string {
  const fwd = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || headers.get("x-real-ip")?.trim() || "unknown";
}
