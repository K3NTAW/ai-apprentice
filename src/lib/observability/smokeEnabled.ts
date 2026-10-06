// Gate for the live Sentry smoke test: runs only when asked for explicitly and a DSN is present.
export function smokeEnabled(env: Record<string, string | undefined>): boolean {
  return env.SENTRY_SMOKE === "1" && !!env.SENTRY_DSN;
}
