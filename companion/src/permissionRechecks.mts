// Permission re-check wiring: app activate/focus, session start and after the settings action, so a permission
// revoked or granted while the app runs is noticed without relaunch. main.mts passes the PermissionMonitor and
// Electron's app; tests pass fakes for both.
import { openPermissionSettings, type PermissionSettingsApis, type PermissionSettingsResult } from "./permissionSettings.mjs";
import { RECHECK_EVENTS, recheckOnActivate, sessionStarted } from "./permissions.mjs";

type Mode = "capture" | "teach" | null | undefined;

export type RecheckApp = { on(event: (typeof RECHECK_EVENTS)[number], fn: () => void): unknown; isReady(): boolean };

export type PermissionRechecks = {
  /** Call on every session.state; re-checks only when a session starts. Returns whether one started. */
  session(prev: Mode, next: Mode): boolean;
  /** openPermissionSettings; once the pane is opened (or refused) the monitor re-checks, then afterCheck runs. */
  openSettings(kind: unknown, apis: Omit<PermissionSettingsApis, "refresh">, afterCheck?: () => void): Promise<PermissionSettingsResult>;
};

/** Registers the activate/focus re-check on app (only once the app is ready) and returns the other two triggers. */
export function wirePermissionRechecks(monitor: { check(): unknown }, app: RecheckApp): PermissionRechecks {
  recheckOnActivate(app, () => {
    if (app.isReady()) monitor.check();
  });
  return {
    session(prev, next) {
      const started = sessionStarted(prev, next);
      if (started) monitor.check();
      return started;
    },
    openSettings: (kind, apis, afterCheck) =>
      openPermissionSettings(kind, {
        ...apis,
        refresh: () => {
          monitor.check();
          afterCheck?.();
        },
      }),
  };
}
