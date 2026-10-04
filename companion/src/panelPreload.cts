// Panel preload (sandboxed, contextIsolation on). One state channel in, a fixed set of actions out.
// main.mts validates every argument and the sender.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("companionPanel", {
  onState(cb: (view: unknown) => void) {
    ipcRenderer.on("panel-state", (_event, view: unknown) => cb(view));
  },
  action(name: string) {
    ipcRenderer.send("panel-action", String(name));
  },
  openControlRoom() {
    ipcRenderer.send("panel-open-control-room");
  },
  openSettings(key: string) {
    ipcRenderer.send("panel-open-settings", String(key));
  },
  setBinding(action: string, accelerator: string) {
    ipcRenderer.send("panel-set-binding", String(action), String(accelerator));
  },
  resetBindings() {
    ipcRenderer.send("panel-reset-bindings");
  },
  setBuddy(on: boolean) {
    ipcRenderer.send("panel-set-buddy", on === true);
  },
  recording(on: boolean) {
    ipcRenderer.send("panel-recording", on === true);
  },
  hide() {
    ipcRenderer.send("panel-hide");
  },
});
