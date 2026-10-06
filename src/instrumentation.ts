// Next.js instrumentation hook. Sentry runs only on the nodejs runtime and only when SENTRY_DSN is set.
// Nothing is imported at the top level: the literal nested guards let the edge bundle drop the Node-only branch.

type RequestInfo = { path: string; method: string; headers: Record<string, string | string[] | undefined> };
type ErrorContext = { routerKind: string; routePath: string; routeType: string };

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.SENTRY_DSN) {
      const { initServer } = await import("./lib/observability/sentryServer");
      initServer();
    }
  }
}

export async function onRequestError(error: unknown, request: RequestInfo, context: ErrorContext) {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.SENTRY_DSN) {
      // Never rejects and never logs: the error may hold untrusted or personal data.
      try {
        const Sentry = await import("@sentry/nextjs");
        Sentry.withScope((scope) => {
          scope.setTag("route", context.routePath);
          scope.setTag("runtime", "nodejs");
          Sentry.captureRequestError(error, request, context);
        });
        // Bounded flush so the event leaves before a serverless function freezes.
        await Sentry.flush(2000);
      } catch {
        // Swallowed on purpose.
      }
    }
  }
}
