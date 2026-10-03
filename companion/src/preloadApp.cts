// Main window preload: window.apprentice. Sandboxed with contextIsolation, so it is self-contained
// (only 'electron' is required). Main decides exposure: the hello answer is null for any page that is
// not the main window's main frame on an allowlisted origin, and then nothing is exposed.
import { contextBridge, ipcRenderer } from "electron";

type Message = { type: string; [key: string]: unknown };
type Handler = (msg: Message) => void;
type Info = { version: string; platform: string; status: Message | null };

const EVENT_TYPES = ["status", "activity", "app", "chord", "shortcut"];
const WINDOW_ACTIONS = ["step-aside", "restore", "focus"];

// First-run setup screen (local file only): save the pasted URL. Main re-checks the sender and https.
if (typeof location !== "undefined" && location.protocol === "file:") {
  contextBridge.exposeInMainWorld("apprenticeSetup", {
    save(url: string): Promise<{ ok: boolean; reason?: string }> {
      return ipcRenderer.invoke("setup-save-url", String(url));
    },
  });
}

const info = ipcRenderer.sendSync("apprentice-hello") as Info | null;

if (info && typeof info === "object") {
  const handlers = new Map<string, Set<Handler>>();
  let lastStatus: Message | null = info.status && typeof info.status === "object" ? info.status : null;

  const deliver = (h: Handler, msg: Message) => {
    try {
      h(msg);
    } catch (err) {
      console.error("apprentice handler failed", err);
    }
  };

  ipcRenderer.on("apprentice-event", (_event, msg: Message) => {
    if (!msg || typeof msg !== "object" || !EVENT_TYPES.includes(msg.type)) return;
    if (msg.type === "status") lastStatus = msg;
    for (const h of handlers.get(msg.type) ?? []) deliver(h, msg);
  });

  contextBridge.exposeInMainWorld("apprentice", {
    version: String(info.version),
    platform: String(info.platform),
    on(type: string, handler: Handler): () => void {
      if (!EVENT_TYPES.includes(type) || typeof handler !== "function") return () => {};
      let set = handlers.get(type);
      if (!set) handlers.set(type, (set = new Set()));
      set.add(handler);
      // The last status is replayed to a new subscriber, so a page that subscribes late still gets it.
      if (type === "status" && lastStatus) {
        const replay = lastStatus;
        queueMicrotask(() => {
          if (set.has(handler)) deliver(handler, replay);
        });
      }
      return () => {
        set.delete(handler);
      };
    },
    send(message: unknown): void {
      ipcRenderer.send("apprentice-send", message);
    },
    window(action: string): void {
      if (WINDOW_ACTIONS.includes(action)) ipcRenderer.send("apprentice-window", action);
    },
  });
}
