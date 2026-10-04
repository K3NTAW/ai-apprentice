// WebSocket glue around SessionGate. No Electron imports.
import { WebSocketServer, type WebSocket } from "ws";
import type { BuddyAction } from "./buddy.mjs";
import type { Allowlist } from "./origin.mjs";
import type { Pairing } from "./pairing.mjs";
import {
  CLOSE,
  MAX_SESSION_PAYLOAD_BYTES,
  parseClientMessage,
  pongMessage,
  toBuddyAction,
  isDockMessage,
  type DockMessage,
  type ServerMessage,
  type SessionStateMessage,
  type StatusMessage,
} from "./protocol.mjs";
import { HELLO_TIMEOUT_MS, SessionGate } from "./session.mjs";

export type ServerHooks = {
  status(): StatusMessage;
  onPairedChange(paired: boolean): void;
  onBuddy(action: BuddyAction): void;
  onSession(state: SessionStateMessage): void;
  onDock(msg: DockMessage): void;
  log(line: string): void;
};

export type CompanionServer = {
  send(msg: ServerMessage): void;
  isPaired(): boolean;
  close(): Promise<void>;
};

export function startServer(port: number, allowlist: Allowlist, pairing: Pairing, hooks: ServerHooks): Promise<CompanionServer> {
  const gate = new SessionGate(allowlist, port, pairing);
  const sockets = new Map<number, WebSocket>();
  let nextId = 1;

  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ host: "127.0.0.1", port, maxPayload: MAX_SESSION_PAYLOAD_BYTES, perMessageDeflate: false });

    const safeClose = (ws: WebSocket, code: number, reason: string) => {
      try {
        ws.close(code, reason);
      } catch {
        ws.terminate();
      }
    };

    wss.on("connection", (ws, req) => {
      const id = nextId++;
      const decision = gate.admit(id, { origin: req.headers.origin, host: req.headers.host });
      if (!decision.ok) {
        hooks.log(`rejected connection: ${decision.reason}`);
        safeClose(ws, decision.code, decision.reason);
        return;
      }
      sockets.set(id, ws);
      const helloTimer = setTimeout(() => {
        if (gate.isPending(id)) safeClose(ws, CLOSE.HELLO_TIMEOUT, "hello_timeout");
      }, HELLO_TIMEOUT_MS);

      ws.on("message", (data, isBinary) => {
        try {
          const parsed = parseClientMessage(isBinary ? new Uint8Array(0) : data.toString());
          if (gate.isPending(id)) {
            if (!parsed.ok || parsed.msg.type !== "hello") {
              safeClose(ws, CLOSE.UNAUTHORIZED, "hello_required");
              return;
            }
            const r = gate.hello(id, parsed.msg.token);
            if (!r.ok) {
              hooks.log(`pairing failed: ${r.reason}`);
              safeClose(ws, r.code, r.reason);
              return;
            }
            clearTimeout(helloTimer);
            ws.send(JSON.stringify(hooks.status()));
            hooks.onPairedChange(true);
            return;
          }
          if (!gate.isPaired(id)) return;
          if (!parsed.ok) {
            hooks.log(`ignored invalid message: ${parsed.reason}`);
            return;
          }
          if (parsed.warning) hooks.log(`dropped part of message: ${parsed.warning}`);
          const msg = parsed.msg;
          if (msg.type === "ping") ws.send(JSON.stringify(pongMessage()));
          else if (msg.type === "session.state") hooks.onSession(msg);
          else if (isDockMessage(msg)) hooks.onDock(msg);
          else if (msg.type === "hello") hooks.log("ignored message: hello after pairing");
          else {
            const action = toBuddyAction(msg);
            if (action) hooks.onBuddy(action);
          }
        } catch (err) {
          hooks.log(`message handler error: ${String(err)}`);
        }
      });
      ws.on("error", (err) => hooks.log(`socket error: ${err.message}`));
      ws.on("close", () => {
        clearTimeout(helloTimer);
        sockets.delete(id);
        if (gate.close(id)) hooks.onPairedChange(false);
      });
    });

    wss.once("listening", () => {
      wss.on("error", (err) => hooks.log(`server error: ${err.message}`));
      resolve({
        send(msg) {
          const id = gate.pairedId();
          const ws = id === null ? undefined : sockets.get(id);
          if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
        },
        isPaired: () => gate.pairedId() !== null,
        close: () =>
          new Promise<void>((done) => {
            for (const ws of sockets.values()) ws.terminate();
            wss.close(() => done());
          }),
      });
    });
    wss.once("error", reject);
  });
}
