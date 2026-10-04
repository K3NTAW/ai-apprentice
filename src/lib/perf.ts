// Server-side timing for pages, where a server component cannot set response headers.
// PERF_LOG=1 prints one line per measured step, e.g. '[perf] ctx-auth 182.3ms'. Pages and route handlers also send Server-Timing
// (ctx-auth, db, total; see proxy.ts and withApi).
export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (process.env.PERF_LOG !== "1") return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    console.info(`[perf] ${name} ${(performance.now() - t0).toFixed(1)}ms`);
  }
}

/** Server-Timing header value, e.g. 'ctx-auth;dur=182.3, db;dur=41.0, total;dur=230.4' (ms). */
export function serverTiming(timings: Record<string, number>): string {
  return Object.entries(timings)
    .map(([name, ms]) => `${name};dur=${ms.toFixed(1)}`)
    .join(", ");
}
