// Crash reporting (@sentry/electron), on only when app.config.json carries a non-empty sentryDsn (written by
// the release runner, see writeReleaseConfig.mts). No PII (dataCollection off), no screenshots, no breadcrumbs; home paths become "~".
import os from "node:os";
import type { ElectronMainOptions } from "@sentry/electron/main";

/**
 * Default integrations removed by exact name. Checked against @sentry/electron 8.1.0 main defaults:
 * ElectronBreadcrumbs, ElectronNet, Screenshots, Console and ChildProcess exist there. The spec's
 * "Breadcrumbs", "Replay", "Net" and "Screenshot" are not main-process names in 8.1.0 and are left out;
 * the real network and screenshot names (ElectronNet, Screenshots) are used instead.
 */
export const DROPPED = new Set(["ElectronBreadcrumbs", "ElectronNet", "Screenshots", "Console", "ChildProcess"]);

type Frame = { abs_path?: string; filename?: string };
type WithFrames = { stacktrace?: { frames?: Frame[] } };
export type ScrubbableEvent = {
  request?: unknown;
  user?: unknown;
  server_name?: string;
  contexts?: { device?: unknown; culture?: unknown };
  exception?: { values?: WithFrames[] };
  threads?: { values?: WithFrames[] };
};

const unhome = (p: string | undefined, home: string): string | undefined =>
  typeof p === "string" && home && (p === home || p.startsWith(home + "/") || p.startsWith(home + "\\")) ? "~" + p.slice(home.length) : p;

export function scrubEvent<E extends ScrubbableEvent>(event: E, home: string = os.homedir()): E {
  delete event.request;
  delete event.user;
  delete event.server_name;
  if (event.contexts) {
    delete event.contexts.device;
    delete event.contexts.culture;
  }
  for (const group of [event.exception?.values, event.threads?.values]) {
    for (const v of group ?? []) {
      for (const f of v.stacktrace?.frames ?? []) {
        if (f.abs_path !== undefined) f.abs_path = unhome(f.abs_path, home);
        if (f.filename !== undefined) f.filename = unhome(f.filename, home);
      }
    }
  }
  return event;
}

export function sentryOptions(dsn: string, home: string = os.homedir()): ElectronMainOptions {
  return {
    dsn,
    // @sentry/core 11 (under @sentry/electron 8.1.0) has no sendDefaultPii; dataCollection replaces it.
    // Everything off: no user info, cookies, headers, bodies, query params or local variables.
    dataCollection: {
      userInfo: false,
      cookies: false,
      httpHeaders: false,
      httpBodies: [],
      urlQueryParams: false,
      stackFrameVariables: false,
    },
    attachScreenshot: false,
    integrations: (defaults) => defaults.filter((i) => !DROPPED.has(i.name)),
    beforeBreadcrumb: () => null,
    beforeSend: (event) => scrubEvent(event, home),
  };
}

function readDsn(text: string | null): string | null {
  if (text == null) return null;
  try {
    const v: unknown = JSON.parse(text);
    const dsn = v && typeof v === "object" ? (v as { sentryDsn?: unknown }).sentryDsn : undefined;
    return typeof dsn === "string" && dsn.trim() !== "" ? dsn : null;
  } catch {
    return null;
  }
}

/** Calls init once when app.config.json has a non-empty sentryDsn; returns whether it did. */
export function initCrashReporting({ configText, init }: { configText: string | null; init: (opts: ElectronMainOptions) => void }): boolean {
  const dsn = readDsn(configText);
  if (!dsn) return false;
  init(sentryOptions(dsn));
  return true;
}
