// COMPANION PROTOCOL message shapes, validation and builders. Electron-free and ws-free.
import { validateHalo, type Halo } from "./overlay.mjs";

export const DEFAULT_PORT = 47321;
export const MAX_PAYLOAD_BYTES = 16 * 1024;

/** WebSocket close codes used by the companion. */
export const CLOSE = {
  /** Missing, malformed or wrong hello / pairing code. */
  UNAUTHORIZED: 4401,
  /** Origin not on the allowlist, or Host header is not loopback (DNS rebinding). */
  FORBIDDEN: 4403,
  /** No valid hello within the hello timeout. */
  HELLO_TIMEOUT: 4408,
  /** Another client is already paired, or too many pending sockets. */
  BUSY: 4409,
  /** Too many failed pairing attempts from this Origin, or across all Origins (60 s global cooldown). */
  LOCKED: 4429,
} as const;

export type Permissions = {
  input: boolean;
  screen: boolean;
  accessibility: boolean;
  /** Optional extension: true when 'input' is backed by an Input Monitoring query or an observed hook event. */
  inputVerified?: boolean;
};

export type StatusMessage = {
  type: "status";
  version: string;
  permissions: Permissions;
  /** Optional extension: true while 'Pause sensing' is on (no activity/app messages are sent). */
  paused?: boolean;
};
export type ActivityMessage = {
  type: "activity";
  t: number;
  typing: boolean;
  pointer: boolean;
  keys: number;
  clicks: number;
  idle_ms: number;
};
export type AppMessage = { type: "app"; t: number; app: string; title: string };
export type PongMessage = { type: "pong" };
export type ServerMessage = StatusMessage | ActivityMessage | AppMessage | PongMessage;

export type HelloMessage = { type: "hello"; token: string };
export type HaloMessage = { type: "overlay.halo" } & Halo;
export type ClearMessage = { type: "overlay.clear"; id?: string };
export type PingMessage = { type: "ping" };
export type ClientMessage = HelloMessage | HaloMessage | ClearMessage | PingMessage;

export type ParseResult = { ok: true; msg: ClientMessage } | { ok: false; reason: string };

const MAX_ID_LENGTH = 128;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Parse and validate one inbound frame. Never throws. */
export function parseClientMessage(raw: unknown): ParseResult {
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (raw instanceof Uint8Array) text = Buffer.from(raw).toString("utf8");
  else return { ok: false, reason: "not_text" };
  if (Buffer.byteLength(text, "utf8") > MAX_PAYLOAD_BYTES) return { ok: false, reason: "too_large" };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!isRecord(data) || typeof data.type !== "string") return { ok: false, reason: "no_type" };
  switch (data.type) {
    case "hello":
      if (typeof data.token !== "string") return { ok: false, reason: "hello_token" };
      return { ok: true, msg: { type: "hello", token: data.token } };
    case "ping":
      return { ok: true, msg: { type: "ping" } };
    case "overlay.clear":
      if (data.id === undefined) return { ok: true, msg: { type: "overlay.clear" } };
      if (typeof data.id !== "string" || data.id.length === 0 || data.id.length > MAX_ID_LENGTH) {
        return { ok: false, reason: "clear_id" };
      }
      return { ok: true, msg: { type: "overlay.clear", id: data.id } };
    case "overlay.halo": {
      const halo = validateHalo(data);
      if (!halo.ok) return { ok: false, reason: halo.reason };
      return { ok: true, msg: { type: "overlay.halo", ...halo.halo } };
    }
    default:
      return { ok: false, reason: "unknown_type" };
  }
}

export function statusMessage(version: string, permissions: Permissions, paused?: boolean): StatusMessage {
  const msg: StatusMessage = {
    type: "status",
    version,
    permissions: {
      input: permissions.input === true,
      screen: permissions.screen === true,
      accessibility: permissions.accessibility === true,
    },
  };
  if (permissions.inputVerified !== undefined) msg.permissions.inputVerified = permissions.inputVerified === true;
  if (paused !== undefined) msg.paused = paused;
  return msg;
}

export function appMessage(t: number, app: string, title: string): AppMessage {
  return { type: "app", t, app: String(app).slice(0, 256), title: String(title).slice(0, 512) };
}

export const pongMessage = (): PongMessage => ({ type: "pong" });

/** Parse COMPANION_PORT. Undefined or empty means the default port. */
export function parsePort(raw: string | undefined): { ok: true; port: number } | { ok: false; reason: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, port: DEFAULT_PORT };
  if (!/^\d{1,5}$/.test(raw.trim())) return { ok: false, reason: `invalid COMPANION_PORT: ${raw}` };
  const port = Number(raw.trim());
  if (port < 1024 || port > 65535) return { ok: false, reason: `COMPANION_PORT out of range: ${raw}` };
  return { ok: true, port };
}
