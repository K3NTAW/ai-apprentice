// Next.js client instrumentation. Sentry loads only when NEXT_PUBLIC_SENTRY_DSN is set at build time.
// No top-level @sentry import: the literal read is inlined by Next, so an unset DSN leaves the SDK out of the page.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  import("./lib/observability/sentryClient")
    .then(({ initClient }) => {
      initClient();
    })
    .catch(() => {
      // Swallowed on purpose: error tracking must never break the page.
    });
}

export {};
