// Agent avatar data URLs (protocol v3). Electron-free.
// An avatar frame is accepted only as data:image/svg+xml;base64,... up to MAX_AVATAR_URL_BYTES. Renderers
// assign it ONLY to an <img src> (static/avatarSrc.js setAvatarSrc), never to innerHTML: an SVG in an
// <img> cannot run scripts or load external resources.

export const AVATAR_STATES = ["idle", "listening", "thinking", "talking", "asking", "stop", "happy", "paused"] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];
export type AvatarSet = Partial<Record<AvatarState, string>>;

/** Per frame cap: the whole data URL, 100 KiB. */
export const MAX_AVATAR_URL_BYTES = 100 * 1024;
/** Cap over all frames of one agent. */
export const MAX_AVATAR_TOTAL_BYTES = 800 * 1024;
/** Same pattern as static/avatarSrc.js (avatarUrl.test.ts checks they agree). */
export const AVATAR_URL_RE = /^data:image\/svg\+xml;base64,[A-Za-z0-9+/]+={0,2}$/;
const PREFIX = "data:image/svg+xml;base64,";

export function isAvatarUrl(v: unknown): v is string {
  return typeof v === "string" && v.length <= MAX_AVATAR_URL_BYTES && (v.length - PREFIX.length) % 4 === 0 && AVATAR_URL_RE.test(v);
}

export function isAvatarState(v: unknown): v is AvatarState {
  return typeof v === "string" && (AVATAR_STATES as readonly string[]).includes(v);
}

/**
 * Validate an avatar map. Unknown keys are ignored; 'idle' is required; any present state that is not a
 * valid data URL, or a total above MAX_AVATAR_TOTAL_BYTES, rejects the whole set.
 */
export function validateAvatarSet(v: unknown): { ok: true; avatar: AvatarSet } | { ok: false; reason: string } {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return { ok: false, reason: "avatar_shape" };
  const d = v as Record<string, unknown>;
  const avatar: AvatarSet = {};
  let total = 0;
  for (const s of AVATAR_STATES) {
    if (!Object.prototype.hasOwnProperty.call(d, s) || d[s] === undefined) continue;
    if (!isAvatarUrl(d[s])) return { ok: false, reason: `avatar_${s}` };
    avatar[s] = d[s] as string;
    total += (d[s] as string).length;
  }
  if (!avatar.idle) return { ok: false, reason: "avatar_idle" };
  if (total > MAX_AVATAR_TOTAL_BYTES) return { ok: false, reason: "avatar_total" };
  return { ok: true, avatar };
}

/** The frame for a state, falling back to idle. */
export function avatarFor(avatar: AvatarSet | undefined, state: AvatarState): string | null {
  return avatar?.[state] ?? avatar?.idle ?? null;
}
