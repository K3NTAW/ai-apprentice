// Server-side timing for pages, where a server component cannot set response headers.
// PERF_LOG=1 prints one line per measured step, e.g. '[perf] ctx-auth 182.3ms'. Route handlers send Server-Timing instead.
export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  if (process.env.PERF_LOG !== "1") return fn();
  const t0 = performance.now();
  try {
    return await fn();
  } finally {
    console.info(`[perf] ${name} ${(performance.now() - t0).toFixed(1)}ms`);
  }
}
