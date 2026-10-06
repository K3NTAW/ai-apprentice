// Sentry browser init (roadmap P0-5). Called from src/instrumentation-client.ts only when NEXT_PUBLIC_SENTRY_DSN is set.
// Browser bundle: must not import the Node-only logger.
import * as Sentry from "@sentry/nextjs";
import type { BrowserOptions } from "@sentry/nextjs";
import { makeBeforeSend } from "./beforeSend";

type Integration = Parameters<Extract<BrowserOptions["integrations"], (...args: never[]) => unknown>>[0][number];

// 11.4.0 has no sendDefaultPii or enableLogs option; dataCollection replaces the first, and logs are off unless an
// integration is added. Every field defaults to collecting. Required<> makes tsc fail if the SDK adds a field we did not set.
export const CLIENT_DATA_COLLECTION_OFF: Required<NonNullable<BrowserOptions["dataCollection"]>> = {
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

// Default integrations dropped: BrowserSession (session tracking) and BrowserTracing (the Next.js SDK adds it by default).
export const DROPPED_INTEGRATIONS = ["BrowserSession", "BrowserTracing"];

const withoutDropped = (defaults: Integration[]) => defaults.filter((i) => !DROPPED_INTEGRATIONS.includes(i.name));

export function initClient() {
  return Sentry.init({
    dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
    dataCollection: CLIENT_DATA_COLLECTION_OFF,
    tracesSampleRate: 0,
    sendClientReports: false,
    beforeSendTransaction: () => null,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV || "development",
    release: process.env.NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA || undefined,
    beforeSend: makeBeforeSend(() => console.warn("sentry.before_send_failed")) as unknown as BrowserOptions["beforeSend"],
    integrations: withoutDropped,
  });
}
