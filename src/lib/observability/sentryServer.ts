// Sentry server init (roadmap P0-5). Called from src/instrumentation.ts only when SENTRY_DSN is set on the nodejs runtime.
import * as Sentry from "@sentry/nextjs";
import type { NodeOptions } from "@sentry/nextjs";
import { log } from "@/lib/log";
import { makeBeforeSend } from "./beforeSend";

// Server session tracking off: drop ProcessSession and re-create Http with sessions: false
// (same disableIncomingRequestSpans the Next.js SDK uses for its own Http replacement).
const withoutSessions = (defaults: Sentry.Integration[]) =>
  defaults
    .filter((i) => i.name !== "ProcessSession")
    .map((i) => (i.name === "Http" ? Sentry.httpIntegration({ disableIncomingRequestSpans: true, sessions: false }) : i));

/** `extra` is spread first, so a caller can add options (e.g. `transport`) but cannot override the fixed ones. */
export function initServer(extra: NodeOptions = {}) {
  return Sentry.init({
    ...extra,
    dsn: process.env.SENTRY_DSN,
    sendDefaultPii: false,
    tracesSampleRate: 0,
    enableLogs: false,
    sendClientReports: false,
    beforeSendTransaction: () => null,
    environment: process.env.VERCEL_ENV || "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    beforeSend: makeBeforeSend(() => log.warn("sentry.before_send_failed")) as unknown as NodeOptions["beforeSend"],
    integrations: withoutSessions,
  });
}
