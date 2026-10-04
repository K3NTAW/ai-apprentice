// Overlay preload (sandboxed, contextIsolation on). Two read-only channels to the page: buddy view and cursor.
import { contextBridge, ipcRenderer } from "electron";

type Rect = { x: number; y: number; w: number; h: number };
type OverlayView = {
  buddy: boolean;
  mode: string;
  say: string | null;
  target: { id: string; rect: Rect; style: string } | null;
  halos: { id: string; rect: Rect; text?: string }[];
  /** Teach with an agent: validated avatar data URL for the current state, else null (orb). */
  avatar: string | null;
};

contextBridge.exposeInMainWorld("companionOverlay", {
  onView(cb: (view: OverlayView) => void) {
    ipcRenderer.on("buddy-view", (_event, view: OverlayView) => cb(view));
  },
  onCursor(cb: (p: { x: number; y: number } | null) => void) {
    ipcRenderer.on("cursor", (_event, p: { x: number; y: number } | null) => cb(p));
  },
});
