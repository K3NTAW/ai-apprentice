// Pairing window preload (sandboxed, contextIsolation on). One state channel in, two actions out.
import { contextBridge, ipcRenderer } from "electron";

type PairingView = {
  code: string;
  paired: boolean;
  stateText: string;
  missing: { key: string; label: string; button: string }[];
};

contextBridge.exposeInMainWorld("companionPairing", {
  onState(cb: (view: PairingView) => void) {
    ipcRenderer.on("pairing-state", (_event, view: PairingView) => cb(view));
  },
  openSettings(key: string) {
    ipcRenderer.send("pairing-open-settings", String(key));
  },
  hide() {
    ipcRenderer.send("pairing-hide");
  },
});
