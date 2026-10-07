// Opt-in mac auto-updater (electron-updater). Electron-free: everything is injected, so it is unit tested.
// On only when app.config.json carries "updates": true. The committed config never carries `updates` or
// `sentryDsn`: only the release runner writes them (writeReleaseConfig.mts, after `npm run build`, before
// `package:signed`). Local package/package:dir builds, dev runs, Windows and a corrupt or missing config: off.

export type UpdateState = "available" | "downloaded";
export type UpdateEvent = { type: "update"; state: UpdateState; version: string };

/** The slice of electron-updater's autoUpdater this module touches. */
export interface AutoUpdaterLike {
  logger: unknown;
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown> | unknown;
}

type Log = { debug: (line: string) => void };
type IntervalHandle = { unref?: () => unknown } | number | undefined;

export type UpdaterDeps = {
  autoUpdater: AutoUpdaterLike | null;
  enabled: boolean;
  intervalMs?: number;
  log: Log;
  onEvent: (msg: UpdateEvent) => void;
  setInterval?: (fn: () => void, ms: number) => IntervalHandle;
  clearInterval?: (h: IntervalHandle) => void;
};

export const UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;

/** True only for a JSON object with `updates === true`. Missing, false, null, corrupt: false. */
export function readUpdatesFlag(text: string | null): boolean {
  if (text == null) return false;
  try {
    const v: unknown = JSON.parse(text);
    return !!v && typeof v === "object" && !Array.isArray(v) && (v as { updates?: unknown }).updates === true;
  } catch {
    return false;
  }
}

const reason = (e: unknown): string => (e instanceof Error ? `${e.name}: ${e.message}` : String(e));

const versionOf = (info: unknown): string => {
  const v = info && typeof info === "object" ? (info as { version?: unknown }).version : undefined;
  return typeof v === "string" ? v : "";
};

export function createUpdater(deps: UpdaterDeps): { start(): void; stop(): void } {
  const { autoUpdater, enabled, intervalMs = UPDATE_INTERVAL_MS, log, onEvent } = deps;
  const setTimer = deps.setInterval ?? ((fn, ms) => globalThis.setInterval(fn, ms));
  const clearTimer = deps.clearInterval ?? ((h) => globalThis.clearInterval(h as Parameters<typeof globalThis.clearInterval>[0]));
  if (!enabled || !autoUpdater) return { start() {}, stop() {} };
  const au = autoUpdater;

  let wired = false;
  let timer: IntervalHandle;
  const seen = new Set<string>();

  const notify = (state: UpdateState) => (info: unknown) => {
    const version = versionOf(info);
    const key = `${state}:${version}`;
    if (seen.has(key)) return;
    seen.add(key);
    onEvent({ type: "update", state, version });
  };

  const wire = () => {
    if (wired) return;
    wired = true;
    au.logger = null;
    au.autoDownload = true;
    au.autoInstallOnAppQuit = true;
    // Before the first check: an emitted 'error' without a listener would be an uncaught exception.
    au.on("error", (e: unknown) => log.debug(`updater.error reason=${reason(e)}`));
    au.on("update-available", notify("available"));
    au.on("update-downloaded", notify("downloaded"));
  };

  // Offline and "no published release" are expected while releases are drafts: debug only, never throws.
  const check = () => {
    Promise.resolve()
      .then(() => au.checkForUpdates())
      .catch((e: unknown) => log.debug(`updater.check_failed reason=${reason(e)}`));
  };

  return {
    start() {
      wire();
      if (timer !== undefined) return;
      check();
      timer = setTimer(check, intervalMs);
      if (timer && typeof timer === "object") timer.unref?.();
    },
    stop() {
      if (timer === undefined) return;
      clearTimer(timer);
      timer = undefined;
    },
  };
}
