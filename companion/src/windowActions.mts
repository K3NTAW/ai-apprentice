// window(action) from the page, and the main window's saved bounds. Electron-free.

export const WINDOW_ACTIONS = ["step-aside", "restore", "focus", "relaunch"] as const;
export type WindowAction = (typeof WINDOW_ACTIONS)[number];

export function isWindowAction(v: unknown): v is WindowAction {
  return typeof v === "string" && (WINDOW_ACTIONS as readonly string[]).includes(v);
}

export type WindowSnapshot = { visible: boolean; minimized: boolean; fullscreen: boolean };
export type WindowOp = "leave-fullscreen" | "minimize" | "show" | "restore" | "focus" | "relaunch";
export type WindowPlan = { ops: WindowOp[]; steppedAside: boolean };

/**
 * State based and idempotent. step-aside minimises once (leaving fullscreen first); a window the user
 * already hid or minimised is left alone. restore acts only after our own step-aside. focus always
 * brings the window forward and ends any step-aside.
 */
export function planWindowAction(action: WindowAction, w: WindowSnapshot, steppedAside: boolean): WindowPlan {
  switch (action) {
    case "step-aside":
      if (steppedAside) return { ops: [], steppedAside: true };
      if (!w.visible || w.minimized) return { ops: [], steppedAside: false };
      return { ops: w.fullscreen ? ["leave-fullscreen", "minimize"] : ["minimize"], steppedAside: true };
    case "restore":
      if (!steppedAside) return { ops: [], steppedAside: false };
      return { ops: bringBack(w), steppedAside: false };
    case "focus":
      return { ops: bringBack(w), steppedAside: false };
    case "relaunch":
      // Onboarding 'Restart app' (T-0211): macOS applies some permission grants only after a restart.
      return { ops: ["relaunch"], steppedAside: false };
  }
}

function bringBack(w: WindowSnapshot): WindowOp[] {
  const ops: WindowOp[] = [];
  if (!w.visible) ops.push("show");
  if (w.minimized) ops.push("restore");
  ops.push("focus");
  return ops;
}

export const MAIN_WINDOW = { width: 1280, height: 820, minWidth: 960, minHeight: 640 } as const;
/** The main window's session: on disk ('persist:'), so the sign-in cookies survive a relaunch (T-0255). */
export const MAIN_PARTITION = "persist:apprentice";
export type Bounds = { x: number; y: number; width: number; height: number };
export type SavedBounds = { width: number; height: number; x?: number; y?: number };
/** Part of the window's top edge that must sit on a display, so it can be grabbed. */
const GRAB = { w: 100, h: 40 };

/**
 * Saved bounds from window-state.json, validated against the current displays' work areas.
 * Corrupt file or off-screen position: default size, centred by Electron.
 */
export function restoreWindowBounds(text: string | null, workAreas: readonly Bounds[]): SavedBounds {
  const fallback = { width: MAIN_WINDOW.width, height: MAIN_WINDOW.height };
  if (text === null) return fallback;
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return fallback;
  }
  if (!data || typeof data !== "object") return fallback;
  const { x, y, width, height } = data as Record<string, unknown>;
  const int = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && Math.abs(v) < 100_000;
  if (!int(x) || !int(y) || !int(width) || !int(height)) return fallback;
  const area = workAreas.find((a) => x >= a.x && y >= a.y && x + GRAB.w <= a.x + a.width && y + GRAB.h <= a.y + a.height);
  if (!area) return fallback;
  return {
    x,
    y,
    width: Math.max(MAIN_WINDOW.minWidth, Math.min(width, area.width)),
    height: Math.max(MAIN_WINDOW.minHeight, Math.min(height, area.height)),
  };
}

export function serializeWindowBounds(b: Bounds): string {
  return JSON.stringify({ x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) });
}
