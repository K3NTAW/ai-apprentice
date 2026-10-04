// App lifecycle without a menu-bar item. Electron-free; main.mts passes app and its window state.
//
// - The Dock icon (taskbar on Windows) is always there; no app.dock.hide().
// - activate (Dock icon click, macOS): reopens the main window when none is visible.
// - Closing the main window: during a session it only hides (the page, the session and the dock or buddy
//   keep running; End task restores it). Without a session macOS keeps the app in the Dock, Windows quits.
// - window-all-closed: quits on Windows only, and never during a session.

export type LifecycleApp = { on(event: "activate" | "window-all-closed", fn: () => void): unknown; quit(): void };

export type LifecycleDeps = {
  platform: NodeJS.Platform;
  /** The main window exists and is visible (not hidden, not minimised). */
  mainVisible(): boolean;
  showMain(): void;
  sessionActive(): boolean;
};

export function quitOnAllClosed(platform: NodeJS.Platform, sessionActive: boolean): boolean {
  return platform === "win32" && !sessionActive;
}

export type MainCloseAction = "allow" | "hide" | "quit";

/** What closing the main window does. 'allow' only while quitting. */
export function mainCloseAction(i: { quitting: boolean; platform: NodeJS.Platform; sessionActive: boolean }): MainCloseAction {
  if (i.quitting) return "allow";
  if (i.sessionActive) return "hide";
  return i.platform === "win32" ? "quit" : "hide";
}

export function installLifecycle(app: LifecycleApp, deps: LifecycleDeps): void {
  app.on("activate", () => {
    if (!deps.mainVisible()) deps.showMain();
  });
  app.on("window-all-closed", () => {
    if (quitOnAllClosed(deps.platform, deps.sessionActive())) app.quit();
  });
}
