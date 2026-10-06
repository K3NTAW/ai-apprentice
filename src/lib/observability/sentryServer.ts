// Sentry server init (roadmap P0-5). Called from src/instrumentation.ts only when SENTRY_DSN is set on the nodejs runtime.
import * as Sentry from "@sentry/nextjs";
import type { NodeOptions } from "@sentry/nextjs";
import { log } from "@/lib/log";
import { makeBeforeSend } from "./beforeSend";

type Integration = Parameters<Extract<NodeOptions["integrations"], (...args: never[]) => unknown>>[0][number];

// Every DataCollection field defaults to collecting in 11.4.0. Required<> makes tsc fail if the SDK adds a field we did not set.
export const DATA_COLLECTION_OFF: Required<NonNullable<NodeOptions["dataCollection"]>> = {
  userInfo: false,
  cookies: false,
  httpHeaders: false,
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
  frameContextLines: 0,
};

// Server session tracking off: drop ProcessSession and re-create Http with sessions: false
// (same disableIncomingRequestSpans the Next.js SDK uses for its own Http replacement).
const withoutSessions = (defaults: Integration[]) =>
  defaults
    .filter((i) => i.name !== "ProcessSession")
    .map((i) => (i.name === "Http" ? Sentry.httpIntegration({ disableIncomingRequestSpans: true, sessions: false }) : i));

/** `extra` is spread first, so a caller can add options (e.g. `transport`) but cannot override the fixed ones. */
export function initServer(extra: NodeOptions = {}) {
  return Sentry.init({
    ...extra,
    dsn: process.env.SENTRY_DSN,
    dataCollection: DATA_COLLECTION_OFF,
    tracesSampleRate: 0,
    sendClientReports: false,
    environment: process.env.VERCEL_ENV || "development",
    release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
    beforeSend: makeBeforeSend(() => log.warn("sentry.before_send_failed")) as unknown as NodeOptions["beforeSend"],
    integrations: withoutSessions,
  });
}
