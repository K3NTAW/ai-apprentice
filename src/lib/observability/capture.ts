// Handled 500 capture (roadmap P0-5). Called once per request by the outermost logRequest in src/lib/log.
// Thrown errors go through onRequestError in src/instrumentation.ts instead. No top-level @sentry import:
// with SENTRY_DSN unset no SDK code is loaded.

/** Sends one "handled 500" message tagged with the route, then flushes for at most 2 s. Never rejects. */
export async function captureHandled500(info: { route: string; requestId: string }): Promise<void> {
  if (!process.env.SENTRY_DSN) return;
  try {
    const Sentry = await import("@sentry/nextjs");
    Sentry.captureMessage("handled 500", { level: "error", tags: { route: info.route } });
    await Sentry.flush(2000);
  } catch {
    // Import failure, SDK throw or flush rejection: the response is unaffected.
  }
}
