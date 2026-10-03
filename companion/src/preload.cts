// Overlay preload (sandboxed, contextIsolation on). Exposes one read-only channel to the page.
import { contextBridge, ipcRenderer } from "electron";

type OverlayHalo = { id: string; rect: { x: number; y: number; w: number; h: number }; text?: string };

contextBridge.exposeInMainWorld("companionOverlay", {
  onHalos(cb: (halos: OverlayHalo[]) => void) {
    ipcRenderer.on("halos", (_event, halos: OverlayHalo[]) => cb(halos));
  },
});
