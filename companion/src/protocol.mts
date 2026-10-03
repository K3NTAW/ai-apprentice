// COMPANION PROTOCOL message shapes, validation and builders. Electron-free and ws-free.
import { BUDDY_MODES, MAX_POINT_TEXT, MAX_SAY, POINT_STYLES, type BuddyAction, type BuddyMode, type PointStyle } from "./buddy.mjs";
import { validateAvatarSet, type AvatarSet } from "./avatarUrl.mjs";
import { DOCK_SIDES, LEARNED_KINDS, MAX_LEARNED_TEXT, type DockSide, type LearnedKind } from "./dock.mjs";
import { validateHalo, validateRect, HALO_TTL_MS, type Halo, type Rect } from "./overlay.mjs";
import type { WireAction } from "./shortcuts.mjs";

export const DEFAULT_PORT = 47321;
export const MAX_PAYLOAD_BYTES = 16 * 1024;
/** session.state only (v3 avatars: up to 8 x 100 KiB data URLs, 800 KiB total, plus texts). Every other type keeps 16 KiB. */
export const MAX_SESSION_PAYLOAD_BYTES = 1024 * 1024;
/** Protocol capability sent in status so the page can feature-detect v2 (buddy.*, session.state, shortcut) and v3 (agent, dock.*, chord). */
export const PROTOCOL_VERSION = 3;
/** session.state.agent limits (code points). A bad agent is dropped; the rest of session.state is kept. */
export const AGENT_LIMITS = { id: 64, name: 60, role: 80 } as const;

/** session.state text limits (code points). Longer texts reject the whole message. */
export const SESSION_LIMITS = { title: 200, expert: 200, last_question: 500, last_answer: 2000, app_url: 2048 } as const;
export const MAX_COUNTER = 1_000_000;

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
  /** v2 capability: 2 means buddy.*, session.state and shortcut are understood. Absent on v1 companions. */
  protocol: number;
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
export type ShortcutMessage = { type: "shortcut"; action: WireAction };
export type ChordMessage = { type: "chord"; t: number; chord: string; app: string };
export type ServerMessage = StatusMessage | ActivityMessage | AppMessage | PongMessage | ShortcutMessage | ChordMessage;

export type HelloMessage = { type: "hello"; token: string };
export type HaloMessage = { type: "overlay.halo" } & Halo;
export type ClearMessage = { type: "overlay.clear"; id?: string };
export type PingMessage = { type: "ping" };
export type BuddyStateMessage = { type: "buddy.state"; state: BuddyMode };
export type BuddySayMessage = { type: "buddy.say"; text: string; ttl_ms?: number };
export type BuddyPointMessage = { type: "buddy.point"; id: string; rect: Rect; text?: string; style: PointStyle; ttl_ms?: number };
export type BuddyClearMessage = { type: "buddy.clear"; id?: string };
export type SessionStateMessage = {
  type: "session.state";
  mode: "capture" | "teach" | null;
  title: string;
  expert: string;
  asked: number;
  guardrails: number;
  last_question: string;
  last_answer: string;
  off_record: boolean;
  app_url: string;
  /** v3, optional: absent in local mode without an agent, or when the agent failed validation. */
  agent?: AgentInfo;
};
export type AgentInfo = { id: string; name: string; role: string; avatar: AvatarSet };
export type DockShowMessage = { type: "dock.show"; side: DockSide };
export type DockHideMessage = { type: "dock.hide" };
export type DockLearnedMessage = { type: "dock.learned"; kind: LearnedKind; text: string };
export type ClientMessage =
  | HelloMessage
  | HaloMessage
  | ClearMessage
  | PingMessage
  | BuddyStateMessage
  | BuddySayMessage
  | BuddyPointMessage
  | BuddyClearMessage
  | SessionStateMessage
  | DockShowMessage
  | DockHideMessage
  | DockLearnedMessage;

/** warning: something was dropped from an otherwise valid message (e.g. a bad session.state.agent). */
export type ParseResult = { ok: true; msg: ClientMessage; warning?: string } | { ok: false; reason: string };

const MAX_ID_LENGTH = 128;

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const bad = (reason: string): ParseResult => ({ ok: false, reason });

function isEnum<T extends string>(v: unknown, values: readonly T[]): v is T {
  return typeof v === "string" && (values as readonly string[]).includes(v);
}

/** Strip control characters; null when not a string or longer than max code points. */
function cleanText(v: unknown, max: number): string | null {
  if (typeof v !== "string") return null;
  // eslint-disable-next-line no-control-regex
  const clean = v.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ");
  return Array.from(clean).length > max ? null : clean;
}

function validId(v: unknown): v is string {
  return typeof v === "string" && v.length > 0 && v.length <= MAX_ID_LENGTH;
}

/** Optional ttl_ms: a finite non-negative number (clamped by the buddy reducer). */
function ttl(v: unknown): { ok: true; ttl?: number } | { ok: false } {
  if (v === undefined) return { ok: true };
  if (typeof v !== "number" || !Number.isFinite(v) || v < 0) return { ok: false };
  return { ok: true, ttl: v };
}

function counter(v: unknown): number | null {
  if (v === undefined) return 0;
  return typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= MAX_COUNTER ? v : null;
}

/** session.state.agent: id [A-Za-z0-9-] up to 64, name 1..60 and role 0..80 code points, avatar per avatarUrl.mts. */
export function parseAgent(v: unknown): { ok: true; agent: AgentInfo } | { ok: false; reason: string } {
  if (!isRecord(v)) return { ok: false, reason: "agent_shape" };
  if (typeof v.id !== "string" || !/^[A-Za-z0-9-]{1,64}$/.test(v.id)) return { ok: false, reason: "agent_id" };
  const name = cleanText(v.name, AGENT_LIMITS.name);
  if (name === null || name.trim() === "") return { ok: false, reason: "agent_name" };
  const role = v.role === undefined ? "" : cleanText(v.role, AGENT_LIMITS.role);
  if (role === null) return { ok: false, reason: "agent_role" };
  const avatar = validateAvatarSet(v.avatar);
  if (!avatar.ok) return avatar;
  return { ok: true, agent: { id: v.id, name, role, avatar: avatar.avatar } };
}

function parseSessionState(d: Record<string, unknown>): ParseResult {
  const mode = d.mode === undefined || d.mode === null ? null : isEnum(d.mode, ["capture", "teach"] as const) ? d.mode : undefined;
  if (mode === undefined) return bad("session_mode");
  const strings: Partial<Record<keyof typeof SESSION_LIMITS, string>> = {};
  for (const key of Object.keys(SESSION_LIMITS) as (keyof typeof SESSION_LIMITS)[]) {
    const t = d[key] === undefined ? "" : cleanText(d[key], SESSION_LIMITS[key]);
    if (t === null) return bad(`session_${key}`);
    strings[key] = t;
  }
  const asked = counter(d.asked);
  const guardrails = counter(d.guardrails);
  if (asked === null || guardrails === null) return bad("session_counter");
  if (d.off_record !== undefined && typeof d.off_record !== "boolean") return bad("session_off_record");
  const agent = d.agent === undefined || d.agent === null ? null : parseAgent(d.agent);
  const msg: SessionStateMessage = {
    type: "session.state",
    mode,
    title: strings.title ?? "",
    expert: strings.expert ?? "",
    asked,
    guardrails,
    last_question: strings.last_question ?? "",
    last_answer: strings.last_answer ?? "",
    off_record: d.off_record === true,
    app_url: strings.app_url ?? "",
  };
  if (agent?.ok) msg.agent = agent.agent;
  return agent && !agent.ok ? { ok: true, msg, warning: `session_${agent.reason}` } : { ok: true, msg };
}

/** Parse and validate one inbound frame. Never throws. */
export function parseClientMessage(raw: unknown): ParseResult {
  let text: string;
  if (typeof raw === "string") text = raw;
  else if (raw instanceof Uint8Array) text = Buffer.from(raw).toString("utf8");
  else return { ok: false, reason: "not_text" };
  const bytes = Buffer.byteLength(text, "utf8");
  // Only session.state may exceed 16 KiB (avatars); checked again on the parsed type below.
  if (bytes > MAX_SESSION_PAYLOAD_BYTES || (bytes > MAX_PAYLOAD_BYTES && !/^\s*\{\s*"type"\s*:\s*"session\.state"/.test(text))) {
    return { ok: false, reason: "too_large" };
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  if (!isRecord(data) || typeof data.type !== "string") return { ok: false, reason: "no_type" };
  if (bytes > MAX_PAYLOAD_BYTES && data.type !== "session.state") return { ok: false, reason: "too_large" };
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
    case "buddy.state":
      if (!isEnum(data.state, BUDDY_MODES)) return bad("buddy_state");
      return { ok: true, msg: { type: "buddy.state", state: data.state } };
    case "buddy.say": {
      const t = cleanText(data.text, MAX_SAY);
      if (t === null || t.trim() === "") return bad("say_text");
      const tt = ttl(data.ttl_ms);
      if (!tt.ok) return bad("say_ttl");
      return { ok: true, msg: { type: "buddy.say", text: t, ...(tt.ttl !== undefined ? { ttl_ms: tt.ttl } : {}) } };
    }
    case "buddy.point": {
      if (!validId(data.id)) return bad("point_id");
      const rect = validateRect(data.rect);
      if (!rect.ok) return bad(rect.reason);
      if (!isEnum(data.style, POINT_STYLES)) return bad("point_style");
      const t = data.text === undefined ? "" : cleanText(data.text, MAX_POINT_TEXT);
      if (t === null) return bad("point_text");
      const tt = ttl(data.ttl_ms);
      if (!tt.ok) return bad("point_ttl");
      const msg: BuddyPointMessage = { type: "buddy.point", id: data.id, rect: rect.rect, style: data.style };
      if (t.trim() !== "") msg.text = t;
      if (tt.ttl !== undefined) msg.ttl_ms = tt.ttl;
      return { ok: true, msg };
    }
    case "buddy.clear":
      if (data.id === undefined) return { ok: true, msg: { type: "buddy.clear" } };
      if (!validId(data.id)) return bad("clear_id");
      return { ok: true, msg: { type: "buddy.clear", id: data.id } };
    case "session.state":
      return parseSessionState(data);
    case "dock.show":
      if (data.side !== undefined && !isEnum(data.side, DOCK_SIDES)) return bad("dock_side");
      return { ok: true, msg: { type: "dock.show", side: data.side ?? "right" } };
    case "dock.hide":
      return { ok: true, msg: { type: "dock.hide" } };
    case "dock.learned": {
      if (!isEnum(data.kind, LEARNED_KINDS)) return bad("learned_kind");
      const t = cleanText(data.text, MAX_LEARNED_TEXT);
      if (t === null || t.trim() === "") return bad("learned_text");
      return { ok: true, msg: { type: "dock.learned", kind: data.kind, text: t.trim() } };
    }
    default:
      return { ok: false, reason: "unknown_type" };
  }
}

export function statusMessage(version: string, permissions: Permissions, paused?: boolean): StatusMessage {
  const msg: StatusMessage = {
    type: "status",
    version,
    protocol: PROTOCOL_VERSION,
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
export const shortcutMessage = (action: WireAction): ShortcutMessage => ({ type: "shortcut", action });
export const chordMessage = (t: number, chord: string, app: string): ChordMessage => ({ type: "chord", t, chord, app: String(app).slice(0, 256) });

/**
 * The one place overlay.* (v1) meets the buddy: overlay.halo is buddy.point style 'stop' (keeping the
 * v1 30 s TTL, refreshed by re-sending), overlay.clear is buddy.clear. Other messages map to null.
 */
export function toBuddyAction(msg: ClientMessage): BuddyAction | null {
  switch (msg.type) {
    case "overlay.halo":
      return { type: "point", id: msg.id, rect: msg.rect, style: "stop", ttl_ms: HALO_TTL_MS, ...(msg.text ? { text: msg.text } : {}) };
    case "overlay.clear":
    case "buddy.clear":
      return msg.id === undefined ? { type: "clear" } : { type: "clear", id: msg.id };
    case "buddy.point":
      return {
        type: "point",
        id: msg.id,
        rect: msg.rect,
        style: msg.style,
        ...(msg.text ? { text: msg.text } : {}),
        ...(msg.ttl_ms !== undefined ? { ttl_ms: msg.ttl_ms } : {}),
      };
    case "buddy.say":
      return { type: "say", text: msg.text, ...(msg.ttl_ms !== undefined ? { ttl_ms: msg.ttl_ms } : {}) };
    case "buddy.state":
      return { type: "state", state: msg.state };
    default:
      return null;
  }
}

/** Parse COMPANION_PORT. Undefined or empty means the default port. */
export function parsePort(raw: string | undefined): { ok: true; port: number } | { ok: false; reason: string } {
  if (raw === undefined || raw.trim() === "") return { ok: true, port: DEFAULT_PORT };
  if (!/^\d{1,5}$/.test(raw.trim())) return { ok: false, reason: `invalid COMPANION_PORT: ${raw}` };
  const port = Number(raw.trim());
  if (port < 1024 || port > 65535) return { ok: false, reason: `COMPANION_PORT out of range: ${raw}` };
  return { ok: true, port };
}
