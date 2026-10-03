// Electron main process: tray, sensing, overlay window, WebSocket server.
import { app, BrowserWindow, ipcMain, Menu, Tray, nativeImage, screen, shell, systemPreferences } from "electron";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ActivityAggregator, AppChangeTracker, WINDOW_MS, toInputKind, type InputKind } from "./activity.mjs";
import { HaloStore, mapRect, type DisplayInfo } from "./overlay.mjs";
import { parseAllowlist } from "./origin.mjs";
import { Pairing } from "./pairing.mjs";
import { formatPairingLine, isPermissionKey, pairingViewModel } from "./pairingWindow.mjs";
import { canStartHook, PermissionMonitor, readPermissions } from "./permissions.mjs";
import { appMessage, parsePort, statusMessage, type Permissions } from "./protocol.mjs";
import { startServer, type CompanionServer } from "./server.mjs";
import { trayIconBitmap } from "./trayIcon.mjs";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const APP_POLL_MS = 500;
const PERMISSION_POLL_MS = 2_000;
const HOOK_EVENTS = ["keydown", "mousedown", "mousemove", "wheel"] as const;

const SETTINGS = {
  accessibility: "x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility",
  input: "x-apple.systempreferences:com.apple.preference.security?Privacy_ListenEvent",
  screen: "x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture",
} as const;

const log = (line: string) => console.log(`[companion] ${line}`);

let tray: Tray | null = null;
let overlay: BrowserWindow | null = null;
let pairingWindow: BrowserWindow | null = null;
let server: CompanionServer | null = null;
let serverError: string | null = null;
let paused = false;
let paired = false;
let hookRunning = false;
const halos = new HaloStore();
const aggregator = new ActivityAggregator(Date.now());
const appTracker = new AppChangeTracker();
const pairing = new Pairing(undefined, (code) => {
  console.log(formatPairingLine(code));
  rebuildMenu();
});

// uiohook-napi is CommonJS with a native addon; load lazily so a missing permission never blocks startup.
type Hook = { on(event: string, cb: () => void): void; start(): void; stop(): void };
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
      hook = (require("uiohook-napi") as { uIOhook: Hook }).uIOhook;
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
}

let appPollBusy = false;
async function pollApp(): Promise<void> {
  if (appPollBusy || paused || !paired || !permissions().accessibility) return;
  appPollBusy = true;
  try {
    const { activeWindow } = await import("get-windows");
    const w = await activeWindow({ accessibilityPermission: false, screenRecordingPermission: false });
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

function pushHalos(): void {
  if (!overlay || overlay.isDestroyed()) return;
  const display = primaryDisplay();
  overlay.webContents.send(
    "halos",
    halos.list().map((h) => ({ id: h.id, rect: mapRect(h.rect, display), ...(h.text ? { text: h.text } : {}) })),
  );
}

function clearHalos(): void {
  if (halos.clear()) pushHalos();
}

function placeOverlay(): void {
  if (!overlay || overlay.isDestroyed()) return;
  overlay.setBounds(primaryDisplay().bounds);
  pushHalos();
}

function createOverlay(): void {
  const { bounds } = primaryDisplay();
  overlay = new BrowserWindow({
    ...bounds,
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
  overlay.setIgnoreMouseEvents(true);
  overlay.setAlwaysOnTop(true, "screen-saver");
  overlay.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlay.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  overlay.webContents.on("will-navigate", (e) => e.preventDefault());
  void overlay.loadFile(path.join(here, "..", "static", "overlay.html"));
  overlay.once("ready-to-show", () => overlay?.showInactive());
  screen.on("display-added", placeOverlay);
  screen.on("display-removed", placeOverlay);
  screen.on("display-metrics-changed", placeOverlay);
}

function setPaused(next: boolean): void {
  paused = next;
  if (paused) {
    stopHook();
    aggregator.reset(Date.now());
    clearHalos();
  } else {
    appTracker.reset();
    startHook();
  }
  server?.send(status());
  rebuildMenu();
}

function pairingView() {
  return pairingViewModel({ code: pairing.current(), paired, permissions: permissions(), serverError });
}

function pushPairingState(): void {
  if (!pairingWindow || pairingWindow.isDestroyed()) return;
  pairingWindow.webContents.send("pairing-state", pairingView());
}

function hidePairingWindow(): void {
  if (pairingWindow && !pairingWindow.isDestroyed()) pairingWindow.close();
}

function showPairingWindow(): void {
  if (pairingWindow && !pairingWindow.isDestroyed()) {
    pairingWindow.show();
    pairingWindow.focus();
    return;
  }
  // Normal window: it shows in the Dock while open, so it is reachable when the tray item is hidden.
  void app.dock?.show();
  const win = new BrowserWindow({
    width: 360,
    height: 220,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    title: "AI Apprentice companion",
    show: false,
    webPreferences: {
      preload: path.join(here, "pairingPreload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  pairingWindow = win;
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  win.webContents.on("will-navigate", (e) => e.preventDefault());
  win.webContents.on("did-finish-load", pushPairingState);
  win.once("ready-to-show", () => win.show());
  win.on("closed", () => {
    if (pairingWindow === win) pairingWindow = null;
    app.dock?.hide();
  });
  void win.loadFile(path.join(here, "..", "static", "pairing.html"));
}

ipcMain.on("pairing-hide", (e) => {
  if (pairingWindow && e.sender === pairingWindow.webContents) hidePairingWindow();
});
ipcMain.on("pairing-open-settings", (e, key: unknown) => {
  if (!pairingWindow || e.sender !== pairingWindow.webContents || !isPermissionKey(key)) return;
  void shell.openExternal(SETTINGS[key]);
});

function trayImage(): Electron.NativeImage {
  const img = nativeImage.createFromBitmap(trayIconBitmap(16), { width: 16, height: 16, scaleFactor: 1 });
  img.addRepresentation({ scaleFactor: 2, width: 32, height: 32, buffer: trayIconBitmap(32) });
  img.setTemplateImage(true);
  return img;
}

function rebuildMenu(): void {
  pushPairingState();
  if (!tray) return;
  const p = permissions();
  const code = pairing.current();
  const items: Electron.MenuItemConstructorOptions[] = [
    { label: serverError ? `Error: ${serverError}` : paired ? "Paired with web app" : "Not paired", enabled: false },
    { label: `Pairing code: ${code.slice(0, 3)} ${code.slice(3)}`, enabled: false },
    { label: "New pairing code", click: () => pairing.rotate() },
    { label: "Show pairing window", click: () => showPairingWindow() },
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
  rebuildMenu();
  createOverlay();
  console.log(formatPairingLine(pairing.current()));
  showPairingWindow();

  const allowlist = parseAllowlist(process.env.COMPANION_ALLOWED_ORIGINS);
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
          if (!next) clearHalos();
          if (next) hidePairingWindow();
          rebuildMenu();
        },
        onHalo(h) {
          if (paused) return;
          halos.upsert(h, Date.now());
          pushHalos();
        },
        onClear(id) {
          if (halos.clear(id)) pushHalos();
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
    if (halos.expire(Date.now())) pushHalos();
  }, 1_000);
  permissionMonitor.start();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("window-all-closed", () => {
    // Menu-bar app: stay alive without windows.
  });
  app.on("before-quit", () => {
    halos.clear();
    pushHalos();
    stopHook();
    void server?.close();
  });
  void app.whenReady().then(boot);
}
