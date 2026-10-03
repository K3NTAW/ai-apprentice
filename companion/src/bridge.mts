// Main-process side of the page bridge (window.apprentice): exposure, sender checks, send routing and
// event forwarding. Electron-free; main.mts wires it to ipcMain and the main window.
import type { BuddyAction } from "./buddy.mjs";
import type { Allowlist } from "./origin.mjs";
import { isUrlAllowed } from "./permissionsGrant.mjs";
import {
  parseClientMessage,
  toBuddyAction,
  type DockHideMessage,
  type DockLearnedMessage,
  type DockShowMessage,
  type ServerMessage,
  type SessionStateMessage,
  type StatusMessage,
} from "./protocol.mjs";

export const BRIDGE_CHANNELS = {
  hello: "apprentice-hello",
  send: "apprentice-send",
  window: "apprentice-window",
  event: "apprentice-event",
} as const;

export const BRIDGE_EVENT_TYPES = ["status", "activity", "app", "chord", "shortcut"] as const;
export const BRIDGE_SEND_TYPES = [
  "buddy.state",
  "buddy.say",
  "buddy.point",
  "buddy.clear",
  "overlay.halo",
  "overlay.clear",
  "dock.show",
  "dock.hide",
  "dock.learned",
  "session.state",
] as const;

export type BridgeSender = {
  /** e.sender is the main window's webContents */
  isMainWebContents: boolean;
  /** e.senderFrame is that webContents' main frame */
  isMainFrame: boolean;
  /** e.senderFrame.url */
  url: string | null | undefined;
};

/** Every bridge ipcMain handler runs only for the main window's main frame on an allowlisted origin. */
export function senderAllowed(s: BridgeSender, list: Allowlist): boolean {
  return s.isMainWebContents && s.isMainFrame && isUrlAllowed(s.url, list);
}

export type BridgeInfo = { version: string; platform: NodeJS.Platform; status: StatusMessage | null };

/**
 * Answer to the preload's synchronous hello. null means the preload exposes nothing: this is the only
 * place that decides whether window.apprentice exists on a page.
 */
export function exposeBridge(s: BridgeSender, list: Allowlist, info: () => BridgeInfo): BridgeInfo | null {
  return senderAllowed(s, list) ? info() : null;
}

export type BridgeHandlers = {
  onBuddy(action: BuddyAction): void;
  onSession(state: SessionStateMessage): void;
  onDock(msg: DockShowMessage | DockHideMessage | DockLearnedMessage): void;
  log(line: string): void;
};

/** send(message) from the page: validated with the protocol parser, then routed. Invalid messages are dropped. */
export function routeBridgeMessage(raw: unknown, h: BridgeHandlers): boolean {
  let text: string;
  if (typeof raw === "string") text = raw;
  else {
    try {
      text = JSON.stringify(raw) ?? "";
    } catch {
      h.log("bridge: dropped unserialisable message");
      return false;
    }
  }
  const parsed = parseClientMessage(text);
  if (!parsed.ok) {
    h.log(`bridge: dropped invalid message: ${parsed.reason}`);
    return false;
  }
  const msg = parsed.msg;
  if (!(BRIDGE_SEND_TYPES as readonly string[]).includes(msg.type)) {
    h.log(`bridge: dropped message type ${msg.type}`);
    return false;
  }
  if (parsed.warning) h.log(`bridge: dropped part of message: ${parsed.warning}`);
  if (msg.type === "session.state") h.onSession(msg);
  else if (msg.type === "dock.show" || msg.type === "dock.hide" || msg.type === "dock.learned") h.onDock(msg);
  else {
    const action = toBuddyAction(msg);
    if (!action) return false;
    h.onBuddy(action);
  }
  return true;
}

export function isBridgeEvent(msg: ServerMessage): boolean {
  return (BRIDGE_EVENT_TYPES as readonly string[]).includes(msg.type);
}

export type EventSinks = {
  /** The WebSocket server, only with COMPANION_WS=1. */
  ws(): { send(msg: ServerMessage): void } | null;
  /** The connected page's webContents, null when no allowlisted page is loaded. */
  page(): { send(channel: string, msg: ServerMessage): void } | null;
};

/** Companion -> web: to the page over the bridge and, when enabled, to the paired WebSocket client. */
export function createForwarder(sinks: EventSinks): (msg: ServerMessage) => void {
  return (msg) => {
    sinks.ws()?.send(msg);
    if (isBridgeEvent(msg)) sinks.page()?.send(BRIDGE_CHANNELS.event, msg);
  };
}
