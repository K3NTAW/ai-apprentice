// Electron main process: tray, sensing, buddy overlays, floating panel, shortcuts, WebSocket server.
import { app, BrowserWindow, globalShortcut, ipcMain, Menu, Tray, nativeImage, powerMonitor, screen, shell, systemPreferences } from "electron";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ActivityAggregator, AppChangeTracker, WINDOW_MS, toInputKind, type InputKind } from "./activity.mjs";
import { checkAppUrl } from "./appUrl.mjs";
import { avatarFor } from "./avatarUrl.mjs";
import { buddyView, cursorPollNeeded, expireBuddy, initialBuddy, reduceBuddy, type BuddyAction } from "./buddy.mjs";
import { chordsEnabled, createChordListener, type ChordGates } from "./chord.mjs";
import {
  avatarState,
  dockBounds,
  dockEnabled,
  dockViewModel,
  initialDock,
  parseDockPrefs,
  reduceDock,
  serializeDockPrefs,
  sessionKey,
  surfaces,
  type DockAction,
} from "./dock.mjs";
import { mapRect, type DisplayInfo } from "./overlay.mjs";
import { parseAllowlist } from "./origin.mjs";
import { Pairing } from "./pairing.mjs";
import { isPanelAction, panelMaterial, panelViewModel } from "./panel.mjs";
import { formatPairingLine, isPermissionKey } from "./pairingWindow.mjs";
import { canStartHook, PermissionMonitor, readPermissions } from "./permissions.mjs";
import { appMessage, chordMessage, parsePort, shortcutMessage, statusMessage, type Permissions, type SessionStateMessage } from "./protocol.mjs";
import {
  allowedWhilePaused,
  buddyEnabled as resolveBuddyEnabled,
  createKeyUpListener,
  isShortcutAction,
  NO_PAGE_HINT,
  releaseKeycode,
  SettingsStore,
  SHORTCUT_ACTIONS,
  TalkHold,
  type ShortcutAction,
} from "./shortcuts.mjs";
import { startServer, type CompanionServer } from "./server.mjs";
import { trayIconBitmap } from "./trayIcon.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const APP_POLL_MS = 500;
const CURSOR_POLL_MS = 16;
const PERMISSION_POLL_MS = 2_000;
const HOOK_EVENTS = ["keydown", "mousedown", "mousemove", "wheel"] as const;

const SETTINGS = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  input: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
} as const;

const log = (line: string) => console.log(`[companion] ${line}`);

let tray: Tray | null = null;
/** One transparent, click-through overlay per display, keyed by display id. */
const overlays = new Map<number, BrowserWindow>();
let panel: BrowserWindow | null = null;
/** Side dock (protocol v3), on the primary display. */
let dockWin: BrowserWindow | null = null;
let server: CompanionServer | null = null;
let serverError: string | null = null;
let paused = false;
let paired = false;
let hookRunning = false;
let buddy = initialBuddy();
let session: SessionStateMessage | null = null;
/** Frontmost app name from the app poll, sent with chords. */
let frontApp = "";
// Rollback switches: COMPANION_DOCK=0 is the v2 orb buddy without dock, COMPANION_CHORDS=0 sends no chords.
const dockOn = dockEnabled(process.env.COMPANION_DOCK);
const chordsOn = chordsEnabled(process.env.COMPANION_CHORDS);
let dock = initialDock();
const allowlist = parseAllowlist(process.env.COMPANION_ALLOWED_ORIGINS);
const settings = new SettingsStore(
  {
    read: () => {
      try {
        return fs.readFileSync(settingsPath(), "utf8");
      } catch {
        return null;
      }
    },
    write: (text) => fs.writeFileSync(settingsPath(), text, { mode: 0o600 }),
  },
  process.platform,
);
const buddyForcedOff = resolveBuddyEnabled(process.env.COMPANION_BUDDY, true) === false;
const buddyOn = () => resolveBuddyEnabled(process.env.COMPANION_BUDDY, settings.get().buddyEnabled);
let registrationErrors: Partial<Record<ShortcutAction, string>> = {};
const talk = new TalkHold((a) => server?.send(shortcutMessage(a)), "toggle");
let talkKeycode: number | null = null;
let keyTable: Record<string, number> = {};
const aggregator = new ActivityAggregator(Date.now());
const appTracker = new AppChangeTracker();
const pairing = new Pairing(undefined, (code) => {
  console.log(formatPairingLine(code));
  rebuildMenu();
});

function dockPrefsPath(): string {
  return path.join(app.getPath("userData"), "dock.json");
}

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

// uiohook-napi is CommonJS with a native addon; load lazily so a missing permission never blocks startup.
type Hook = { on(event: string, cb: (e?: unknown) => void): void; start(): void; stop(): void };
let hook: Hook | null = null;

// Electron has no Input Monitoring query, so inputMonitoringStatus is not passed: input is reported
// true only after the hook has delivered its first event (see permissions.mts).
let inputEventSeen = false;
const permissionApis = {
  platform: process.platform,
  isTrustedAccessibilityClient: (prompt: boolean) => systemPreferences.isTrustedAccessibilityClient(prompt),
  getMediaAccessStatus: (type: "screen") => systemPreferences.getMediaAccessStatus(type),
  hookEventSeen: () => inputEventSeen,
};
function permissions(): Permissions {
  return readPermissions(permissionApis);
}

const status = () => statusMessage(app.getVersion(), permissions(), paused);

function startHook(): void {
  if (hookRunning || paused || !canStartHook(permissionApis)) return;
  try {
    if (!hook) {
      const mod = require("uiohook-napi") as { uIOhook: Hook; UiohookKey: Record<string, number> };
      hook = mod.uIOhook;
      keyTable = mod.UiohookKey;
      talkKeycode = releaseKeycode(settings.get().bindings.talk, keyTable);
      // Key-up for the talk hold: shortcuts.mts is the only module that reads keycodes (compare only).
      hook.on("keyup", createKeyUpListener(() => talkKeycode, () => talk.release()));
      // Chords: chord.mts is the only module that reads keydown keycodes and modifier flags.
      hook.on(
        "keydown",
        createChordListener(keyTable, chordGates, (chord) => server?.send(chordMessage(Date.now(), chord, frontApp))),
      );
      for (const name of HOOK_EVENTS) {
        // The handler takes no arguments: keycode, char and x/y never enter this process's state.
        hook.on(name, () => {
          const kind: InputKind | null = toInputKind(name);
          if (!kind) return;
          if (!inputEventSeen) {
            inputEventSeen = true;
            permissionMonitor.check();
          }
          if (paused) return;
          aggregator.record(kind, Date.now());
        });
      }
    }
    hook.start();
    hookRunning = true;
    talk.setMode(talkKeycode === null ? "toggle" : "hold");
    pushPanel();
  } catch (err) {
    log(`input hook unavailable: ${String(err)}`);
  }
}

function stopHook(): void {
  if (!hookRunning || !hook) return;
  try {
    hook.stop();
  } catch (err) {
    log(`input hook stop failed: ${String(err)}`);
  }
  hookRunning = false;
  // No key-up without the hook: end any hold and fall back to press-to-toggle.
  talk.setMode("toggle");
  pushPanel();
}

let appPollBusy = false;
async function pollApp(): Promise<void> {
  if (appPollBusy || paused || !paired || !permissions().accessibility) return;
  appPollBusy = true;
  try {
    const { activeWindow } = await import("get-windows");
    const w = await activeWindow({ accessibilityPermission: false, screenRecordingPermission: false });
    if (w && !paused) frontApp = w.owner.name;
    if (w && !paused && appTracker.changed(w.owner.name, w.title)) server?.send(appMessage(Date.now(), w.owner.name, w.title));
  } catch (err) {
    log(`active window unavailable: ${String(err)}`);
  } finally {
    appPollBusy = false;
  }
}

const permissionMonitor = new PermissionMonitor(permissions, () => {
  startHook();
  server?.send(status());
  rebuildMenu();
});

function primaryDisplay(): DisplayInfo {
  const d = screen.getPrimaryDisplay();
  return { bounds: d.bounds, scaleFactor: d.scaleFactor };
}

/**
 * Secure input: Electron exposes no IsSecureEventInputEnabled and the companion adds no native module
 * for it, so there is no check on any platform (null). classifyChord then emits only Cmd/Ctrl/Alt
 * combinations. On macOS, secure input also keeps key events away from the event tap uiohook uses.
 */
function chordGates(): ChordGates {
  const s = settings.get();
  return {
    enabled: chordsOn,
    paired,
    paused,
    offRecord: session?.off_record === true,
    buddyPaused: buddy.mode === "paused",
    secureInput: null,
    platform: process.platform,
    ownBindings: Object.values(s.bindings),
  };
}

function dispatchDock(action: DockAction): void {
  dock = reduceDock(dock, action);
  pushView();
}

function currentSurfaces() {
  return surfaces({ dockEnabled: dockOn, paired, mode: session?.mode ?? null, page: dock.page });
}

function dockWorkArea(): Electron.Rectangle {
  return screen.getPrimaryDisplay().workArea;
}

function createDock(): BrowserWindow {
  const win = new BrowserWindow({
    ...dockBounds(dockWorkArea(), dock.side, dock.collapsed),
    // macOS: a non-activating panel; with focusable false and showInactive it never takes focus from the expert's app.
    ...(process.platform === "darwin" ? { type: "panel" as const } : {}),
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    title: "AI Apprentice agent",
    webPreferences: {
      preload: path.join(here, "dockPreload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setAlwaysOnTop(true, "floating");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Like the overlays: keep the dock out of the whole-monitor frames sent to vision.
  win.setContentProtection(true);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("did-finish-load", pushDock);
  win.on("closed", () => {
    if (dockWin === win) dockWin = null;
  });
  void win.loadFile(path.join(here, "..", "static", "dock.html"));
  win.once("ready-to-show", () => {
    if (currentSurfaces().dock) win.showInactive();
  });
  return win;
}

/** Show, place or hide the dock per the mode rules (dock.mts). Called from pushView and on display changes. */
function syncDock(): void {
  if (!dockOn) return;
  const want = currentSurfaces().dock;
  if (!want) {
    if (dockWin && !dockWin.isDestroyed() && dockWin.isVisible()) dockWin.hide();
    return;
  }
  if (!dockWin || dockWin.isDestroyed()) {
    dockWin = createDock();
    return;
  }
  dockWin.setBounds(dockBounds(dockWorkArea(), dock.side, dock.collapsed));
  if (!dockWin.isVisible()) dockWin.showInactive();
  pushDock();
}

function pushDock(): void {
  if (!dockWin || dockWin.isDestroyed()) return;
  const now = Date.now();
  const live = expireBuddy(buddy, now);
  const view = buddyView(buddy, now, { enabled: true, paused });
  dockWin.webContents.send(
    "dock-state",
    dockViewModel({ state: dock, session, mode: view.mode, target: view.target?.style ?? null, say: live.say?.text ?? null, paused }),
  );
}

function dispatch(action: BuddyAction): void {
  buddy = reduceBuddy(buddy, action, Date.now());
  pushView();
}

/** Local bubble (no page involved), e.g. the 'open the control room' hint. */
function localSay(text: string): void {
  dispatch({ type: "say", text, ttl_ms: 4_000 });
}

function pushView(): void {
  const now = Date.now();
  const surf = currentSurfaces();
  const view = buddyView(buddy, now, { enabled: buddyOn() && surf.buddy, paused });
  // Teach with an agent: the buddy is drawn with the agent avatar (no agent or COMPANION_DOCK=0: the orb).
  const agent = dockOn && session?.mode === "teach" ? session.agent : undefined;
  const avatar = agent ? avatarFor(agent.avatar, avatarState(view.mode, view.target?.style ?? null)) : null;
  const primary = screen.getPrimaryDisplay();
  const display = primaryDisplay();
  for (const [id, win] of overlays) {
    if (win.isDestroyed()) continue;
    const isPrimary = id === primary.id;
    // Rects are normalised to the primary display, so halos and pointing targets draw only there.
    win.webContents.send("buddy-view", {
      ...view,
      avatar,
      target: isPrimary && view.target ? { ...view.target, rect: mapRect(view.target.rect, display) } : null,
      halos: isPrimary ? view.halos.map((h) => ({ ...h, rect: mapRect(h.rect, display) })) : [],
    });
  }
  updateCursorLoop();
  syncDock();
  pushPanel();
}

let cursorTimer: NodeJS.Timeout | null = null;
function updateCursorLoop(): void {
  const live = expireBuddy(buddy, Date.now());
  const need = cursorPollNeeded({ enabled: buddyOn() && currentSurfaces().buddy, visible: overlays.size > 0, paused, paired, sayActive: live.say !== null });
  if (need && !cursorTimer) cursorTimer = setInterval(pushCursor, CURSOR_POLL_MS);
  if (!need && cursorTimer) {
    clearInterval(cursorTimer);
    cursorTimer = null;
    for (const win of overlays.values()) if (!win.isDestroyed()) win.webContents.send("cursor", null);
  }
}

function pushCursor(): void {
  const p = screen.getCursorScreenPoint();
  for (const win of overlays.values()) {
    if (win.isDestroyed()) continue;
    const b = win.getBounds();
    const inside = p.x >= b.x && p.x < b.x + b.width && p.y >= b.y && p.y < b.y + b.height;
    win.webContents.send("cursor", inside ? { x: p.x - b.x, y: p.y - b.y } : null);
  }
}

function createOverlay(display: Electron.Display): BrowserWindow {
  const win = new BrowserWindow({
    ...display.bounds,
    transparent: true,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    focusable: false,
    skipTaskbar: true,
    show: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    webPreferences: {
      preload: path.join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  win.setIgnoreMouseEvents(true);
  win.setAlwaysOnTop(true, "screen-saver");
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Keep the buddy, bubble and halo out of screen captures (the frames the web page sends to vision).
  win.setContentProtection(true);
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("did-finish-load", pushView);
  void win.loadFile(path.join(here, "..", "static", "overlay.html"));
  win.once("ready-to-show", () => win.showInactive());
  return win;
}

/** Match overlays to the current displays: create, move or destroy (display-added/removed/metrics-changed). */
function syncOverlays(): void {
  const displays = screen.getAllDisplays();
  const ids = new Set(displays.map((d) => d.id));
  for (const [id, win] of overlays) {
    if (!ids.has(id) || win.isDestroyed()) {
      if (!win.isDestroyed()) win.destroy();
      overlays.delete(id);
    }
  }
  for (const d of displays) {
    const win = overlays.get(d.id);
    if (win) win.setBounds(d.bounds);
    else overlays.set(d.id, createOverlay(d));
  }
  // pushView also re-places the dock on the (possibly new) primary display's work area.
  pushView();
}

function setPaused(next: boolean): void {
  paused = next;
  if (paused) {
    talk.cancel();
    stopHook();
    aggregator.reset(Date.now());
    frontApp = "";
    dispatch({ type: "clear" });
  } else {
    appTracker.reset();
    startHook();
    pushView();
  }
  server?.send(status());
  rebuildMenu();
}

function onShortcut(action: ShortcutAction): void {
  if (action === "panel_toggle") {
    togglePanel();
    return;
  }
  if ((paused || buddy.mode === "paused") && !allowedWhilePaused(action)) {
    localSay("Paused. Resume to talk.");
    return;
  }
  if (!paired) {
    localSay(NO_PAGE_HINT);
    return;
  }
  if (action === "talk") talk.press(Date.now());
  else server?.send(shortcutMessage(action));
}

/** (Re)register every binding. Failures are kept per action and shown in the panel, never silent. */
function registerShortcuts(): void {
  globalShortcut.unregisterAll();
  registrationErrors = {};
  const { bindings } = settings.get();
  for (const action of SHORTCUT_ACTIONS) {
    let ok = false;
    try {
      ok = globalShortcut.register(bindings[action], () => onShortcut(action));
    } catch (err) {
      log(`shortcut ${action} invalid: ${String(err)}`);
    }
    if (!ok) {
      registrationErrors[action] = "Could not register: in use by the system or another app";
      log(`shortcut ${action} not registered: ${bindings[action]}`);
    }
  }
  talkKeycode = releaseKeycode(bindings.talk, keyTable);
  if (hookRunning) talk.setMode(talkKeycode === null ? "toggle" : "hold");
  pushPanel();
}

function panelView() {
  const s = settings.get();
  return panelViewModel({
    code: pairing.current(),
    paired,
    permissions: permissions(),
    serverError,
    platform: process.platform,
    paused,
    session,
    allowlist,
    bindings: s.bindings,
    registrationErrors,
    talkMode: talk.getMode(),
    buddyEnabled: buddyOn(),
    buddyForcedOff,
  });
}

function pushPanel(): void {
  if (!panel || panel.isDestroyed()) return;
  panel.webContents.send("panel-state", panelView());
}

function hidePanel(): void {
  if (panel && !panel.isDestroyed() && panel.isVisible()) panel.hide();
  app.dock?.hide();
}

function showPanel(): void {
  if (panel && !panel.isDestroyed()) {
    void app.dock?.show();
    panel.show();
    panel.focus();
    pushPanel();
    return;
  }
  // Shows in the Dock while open, so it is reachable when the tray item is hidden by the notch.
  void app.dock?.show();
  const material = panelMaterial(process.platform, process.getSystemVersion());
  const win = new BrowserWindow({
    width: 380,
    height: 520,
    frame: false,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "AI Apprentice companion",
    show: false,
    ...(material === "vibrancy" ? { vibrancy: "under-window" as const, visualEffectState: "active" as const, backgroundColor: "#00000000" } : {}),
    ...(material === "mica" ? { backgroundMaterial: "mica" as const, backgroundColor: "#00000000" } : {}),
    webPreferences: {
      preload: path.join(here, "panelPreload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  panel = win;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("did-finish-load", pushPanel);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (panel === win) panel = null;
    app.dock?.hide();
  });
  void win.loadFile(path.join(here, "..", "static", "panel.html"), { query: { material } });
}

function togglePanel(): void {
  if (panel && !panel.isDestroyed() && panel.isVisible()) hidePanel();
  else showPanel();
}

const fromPanel = (e: Electron.IpcMainEvent) => panel !== null && !panel.isDestroyed() && e.sender === panel.webContents;

const fromDock = (e: Electron.IpcMainEvent) => dockWin !== null && !dockWin.isDestroyed() && e.sender === dockWin.webContents;

ipcMain.on("dock-action", (e, action: unknown) => {
  if (fromDock(e) && isPanelAction(action)) onShortcut(action);
});
ipcMain.on("dock-collapse", (e, on: unknown) => {
  if (!fromDock(e) || typeof on !== "boolean") return;
  dispatchDock({ type: "collapse", collapsed: on });
  try {
    fs.writeFileSync(dockPrefsPath(), serializeDockPrefs({ collapsed: on }), { mode: 0o600 });
  } catch (err) {
    log(`dock prefs not saved: ${String(err)}`);
  }
});

ipcMain.on("panel-hide", (e) => {
  if (fromPanel(e)) hidePanel();
});
ipcMain.on("panel-action", (e, action: unknown) => {
  if (fromPanel(e) && isPanelAction(action)) onShortcut(action);
});
ipcMain.on("panel-open-control-room", (e) => {
  if (!fromPanel(e) || !session) return;
  const url = checkAppUrl(session.app_url, allowlist);
  if (url.ok) void shell.openExternal(url.href);
  else log(`control room not opened: ${url.reason}`);
});
ipcMain.on("panel-open-settings", (e, key: unknown) => {
  if (!fromPanel(e) || process.platform !== "darwin" || !isPermissionKey(key)) return;
  void shell.openExternal(SETTINGS[key]);
});
ipcMain.on("panel-new-code", (e) => {
  if (fromPanel(e)) pairing.rotate();
});
ipcMain.on("panel-set-binding", (e, action: unknown, accelerator: unknown) => {
  if (!fromPanel(e) || !isShortcutAction(action)) return;
  const r = settings.setBinding(action, accelerator);
  if (!r.ok) {
    registrationErrors = { ...registrationErrors, [action]: r.reason };
    pushPanel();
    return;
  }
  registerShortcuts();
});
ipcMain.on("panel-reset-bindings", (e) => {
  if (!fromPanel(e)) return;
  settings.resetBindings();
  registerShortcuts();
});
ipcMain.on("panel-set-buddy", (e, on: unknown) => {
  if (!fromPanel(e) || typeof on !== "boolean") return;
  settings.setBuddyEnabled(on);
  pushView();
});
// While the panel records a new binding, the old shortcuts must not fire.
ipcMain.on("panel-recording", (e, on: unknown) => {
  if (!fromPanel(e)) return;
  if (on === true) globalShortcut.unregisterAll();
  else registerShortcuts();
});

function trayImage(): Electron.NativeImage | string {
  // Windows: a real .ico; macOS: a template image drawn in code.
  if (process.platform === "win32") return path.join(here, "..", "static", "icon.ico");
  const img = nativeImage.createFromBitmap(trayIconBitmap(16), { width: 16, height: 16, scaleFactor: 1 });
  img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: trayIconBitmap(32) });
  img.setTemplateImage(true);
  return img;
}

function rebuildMenu(): void {
  pushPanel();
  if (!tray) return;
  const p = permissions();
  const code = pairing.current();
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: serverError ? `Error: ${serverError}` : paired ? "Paired with web app" : "Not paired", enabled: false },
    { label: `Pairing code: ${code.slice(0, 3)} ${code.slice(3)}`, enabled: false },
    { label: "New pairing code", click: () => pairing.rotate() },
    { label: "Show panel", click: () => showPanel() },
    { type: "separator" },
  ];
  if (process.platform === "darwin") {
    if (!p.accessibility) items.push({ label: "Grant Accessibility…", click: () => void shell.openExternal(SETTINGS.accessibility) });
    if (!p.input) items.push({ label: "Check Input Monitoring…", click: () => void shell.openExternal(SETTINGS.input) });
    if (!p.screen) items.push({ label: "Grant Screen Recording (window titles)…", click: () => void shell.openExternal(SETTINGS.screen) });
    if (!p.accessibility || !p.input || !p.screen) items.push({ type: "separator" });
  }
  items.push(
    { label: "Pause sensing", type: "checkbox", checked: paused, click: (item) => setPaused(item.checked) },
    { label: "Quit", click: () => app.quit() },
  );
  tray.setContextMenu(Menu.buildFromTemplate(items));
  tray.setTitle(serverError ? "AI !" : paused ? "AI ‖" : paired ? "AI ●" : "AI");
}

async function boot(): Promise<void> {
  app.dock?.hide();
  tray = new Tray(trayImage());
  tray.setToolTip("AI Apprentice Companion");
  // Windows has no menu on left click: toggle the panel (the context menu stays on right click).
  if (process.platform === "win32") tray.on("click", () => togglePanel());
  rebuildMenu();
  try {
    dock = initialDock(parseDockPrefs(fs.readFileSync(dockPrefsPath(), "utf8")).collapsed);
  } catch {
    dock = initialDock();
  }
  syncOverlays();
  screen.on("display-added", syncOverlays);
  screen.on("display-removed", syncOverlays);
  screen.on("display-metrics-changed", syncOverlays);
  registerShortcuts();
  // Safety for the talk hold: a locked or sleeping machine never leaves talk running.
  powerMonitor.on("lock-screen", () => talk.cancel());
  powerMonitor.on("suspend", () => talk.cancel());
  console.log(formatPairingLine(pairing.current()));
  showPanel();

  for (const e of allowlist.errors) log(e);
  const port = parsePort(process.env.COMPANION_PORT);
  if (!port.ok) {
    serverError = port.reason;
  } else {
    try {
      server = await startServer(port.port, allowlist, pairing, {
        status,
        log,
        onPairedChange(next) {
          paired = next;
          appTracker.reset();
          if (!next) {
            talk.cancel();
            session = null;
            buddy = initialBuddy();
            frontApp = "";
            // Unpair: dock hidden (no session) and its feed cleared.
            dock = reduceDock(dock, { type: "reset" });
          }
          pushView();
          rebuildMenu();
        },
        onBuddy(action) {
          // While paused nothing new is drawn; clear is always honoured.
          if (paused && action.type !== "clear") return;
          dispatch(action);
        },
        onSession(next) {
          session = next;
          // A new session (agent, mode or title change) clears the feed and the page's dock override.
          dock = reduceDock(dock, { type: "session", key: sessionKey(next) });
          pushView();
        },
        onDock(msg) {
          if (msg.type === "dock.show") dispatchDock({ type: "show", side: msg.side });
          else if (msg.type === "dock.hide") dispatchDock({ type: "hide" });
          else dispatchDock({ type: "learned", kind: msg.kind, text: msg.text });
        },
      });
      log(`listening on ws://127.0.0.1:${port.port}`);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      serverError = code === "EADDRINUSE" ? `port ${port.port} is in use` : `server failed: ${String(err)}`;
    }
  }
  rebuildMenu();

  setInterval(() => {
    const msg = aggregator.flush(Date.now());
    if (paired && !paused) server?.send(msg);
  }, WINDOW_MS);
  setInterval(() => void pollApp(), APP_POLL_MS);
  setInterval(() => permissionMonitor.check(), PERMISSION_POLL_MS);
  setInterval(() => {
    const now = Date.now();
    talk.tick(now);
    const next = expireBuddy(buddy, now);
    if (next !== buddy) {
      buddy = next;
      pushView();
    }
  }, 250);
  permissionMonitor.start();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("window-all-closed", () => {
    // Menu-bar app: stay alive without windows.
  });
  app.on("before-quit", () => {
    talk.cancel();
    buddy = initialBuddy();
    pushView();
    globalShortcut.unregisterAll();
    stopHook();
    void server?.close();
  });
  void app.whenReady().then(boot);
}
