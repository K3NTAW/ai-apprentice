// In-memory throttle (sliding window; a blocked attempt is not counted). Per server instance only (a serverless
// cold start resets it); Supabase's own Auth rate limits still apply behind it. Used by POST /api/auth/bootstrap.

export const BOOTSTRAP_WINDOW_MS = 10 * 60 * 1000;
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

/** POST /api/auth/bootstrap, signed in: at most 20 calls per user id in 10 minutes, then 429. */
export const BOOTSTRAP_MAX_PER_USER = 20;
/** POST /api/auth/bootstrap, no session (the 401s only): a looser 60 per IP in 10 minutes, then 429. */
export const BOOTSTRAP_MAX_UNAUTH_PER_IP = 60;

const userThrottle = createThrottle({ limit: BOOTSTRAP_MAX_PER_USER, windowMs: BOOTSTRAP_WINDOW_MS });
const unauthIpThrottle = createThrottle({ limit: BOOTSTRAP_MAX_UNAUTH_PER_IP, windowMs: BOOTSTRAP_WINDOW_MS });

/** The two bootstrap limits: authenticated attempts by user id, unauthenticated ones by client IP. */
export const bootstrapThrottle = {
  user: userThrottle,
  unauthIp: unauthIpThrottle,
  reset() {
    userThrottle.reset();
    unauthIpThrottle.reset();
  },
};

/**
 * The client IP. Assumption (Vercel): the platform sets x-vercel-forwarded-for and x-real-ip itself and overwrites
 * any client-sent value, so they are preferred; x-forwarded-for (first entry) is the fallback off Vercel, where a
 * client can spoof it. "unknown" when absent.
 */
export function clientIp(headers: Headers): string {
  const first = (name: string) => headers.get(name)?.split(",")[0]?.trim();
  return first("x-vercel-forwarded-for") || first("x-real-ip") || first("x-forwarded-for") || "unknown";
}
