// Dock preload (sandboxed, contextIsolation on). One state channel in, the panel actions and collapse out.
// main.mts validates every argument and the sender.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("companionDock", {
  onState(cb: (view: unknown) => void) {
    ipcRenderer.on("dock-state", (_event, view: unknown) => cb(view));
  },
  action(name: string) {
    ipcRenderer.send("dock-action", String(name));
  },
  collapse(on: boolean) {
    ipcRenderer.send("dock-collapse", on === true);
  },
});
