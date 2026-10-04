// Cursor buddy state: a pure reducer with an injected clock. Electron-free.
// Supersedes the halo list for drawing: a 'stop' point IS a halo (one per id). overlay.mts stays the
// rect validation and mapping helper; protocol.mts maps overlay.halo/overlay.clear onto these actions.
import type { Rect } from "./overlay.mjs";

export const BUDDY_MODES = ["idle", "listening", "thinking", "speaking", "paused"] as const;
export type BuddyMode = (typeof BUDDY_MODES)[number];
export const POINT_STYLES = ["glance", "stop"] as const;
export type PointStyle = (typeof POINT_STYLES)[number];

export const MAX_SAY = 280;
export const MAX_POINT_TEXT = 140;
export const SAY_TTL_MS = 6_000;
export const TTL_MIN_MS = 100;
export const TTL_MAX_MS = 30_000;
/** Flight time to a rect (the renderer animates 300-500 ms). */
export const FLY_MS = 400;
/** How long a glance rests on its rect before flying back to the cursor. */
export const GLANCE_PAUSE_MS = 1_200;
/** Live 'stop' ids; the oldest is evicted past this. */
export const MAX_STOPS = 8;

export type BuddyAction =
  | { type: "state"; state: BuddyMode }
  | { type: "say"; text: string; ttl_ms?: number }
  | { type: "point"; id: string; rect: Rect; text?: string; style: PointStyle; ttl_ms?: number }
  | { type: "clear"; id?: string };

export type Say = { text: string; expiresAt: number };
export type Point = { id: string; rect: Rect; text?: string; style: PointStyle; at: number; expiresAt: number | null };
export type Buddy = { mode: BuddyMode; say: Say | null; glance: Point | null; stops: Point[] };

export const initialBuddy = (): Buddy => ({ mode: "idle", say: null, glance: null, stops: [] });

/** Clamp an optional ttl to TTL_MIN_MS..TTL_MAX_MS; missing or not finite means the fallback. */
export function clampTtl(ttl: number | undefined, fallback: number): number {
  if (typeof ttl !== "number" || !Number.isFinite(ttl)) return fallback;
  return Math.min(TTL_MAX_MS, Math.max(TTL_MIN_MS, Math.round(ttl)));
}

/** Drop the expired say, glance and stops. Returns the same object when nothing expired. */
export function expireBuddy(s: Buddy, now: number): Buddy {
  const say = s.say && s.say.expiresAt <= now ? null : s.say;
  const glance = s.glance && s.glance.expiresAt !== null && s.glance.expiresAt <= now ? null : s.glance;
  const stops = s.stops.filter((p) => p.expiresAt === null || p.expiresAt > now);
  if (say === s.say && glance === s.glance && stops.length === s.stops.length) return s;
  return { ...s, say, glance, stops };
}

/**
 * Precedence: say replaces say; a new point (any style) replaces an in-flight glance and any stop
 * with the same id; buddy.state never cancels a stop; clear without id clears say, glance and stops.
 */
export function reduceBuddy(prev: Buddy, a: BuddyAction, now: number): Buddy {
  const s = expireBuddy(prev, now);
  switch (a.type) {
    case "state":
      return s.mode === a.state ? s : { ...s, mode: a.state };
    case "say":
      return { ...s, say: { text: Array.from(a.text).slice(0, MAX_SAY).join(""), expiresAt: now + clampTtl(a.ttl_ms, SAY_TTL_MS) } };
    case "point": {
      const base = { id: a.id, rect: a.rect, style: a.style, at: now, ...(a.text ? { text: Array.from(a.text).slice(0, MAX_POINT_TEXT).join("") } : {}) };
      const others = s.stops.filter((p) => p.id !== a.id);
      if (a.style === "glance") {
        return { ...s, stops: others, glance: { ...base, expiresAt: now + FLY_MS + clampTtl(a.ttl_ms, GLANCE_PAUSE_MS) } };
      }
      const stop: Point = { ...base, expiresAt: a.ttl_ms === undefined ? null : now + clampTtl(a.ttl_ms, TTL_MAX_MS) };
      const stops = [...others, stop];
      while (stops.length > MAX_STOPS) stops.shift();
      return { ...s, glance: null, stops };
    }
    case "clear":
      if (a.id === undefined) return { ...s, say: null, glance: null, stops: [] };
      return { ...s, glance: s.glance?.id === a.id ? null : s.glance, stops: s.stops.filter((p) => p.id !== a.id) };
  }
}

/** Where the buddy is: a rect it points at (glance first, then the newest stop) or null for the cursor. */
export function anchorOf(s: Buddy, now: number): { id: string; rect: Rect } | null {
  const live = expireBuddy(s, now);
  const p = live.glance ?? live.stops[live.stops.length - 1] ?? null;
  return p ? { id: p.id, rect: p.rect } : null;
}

export type BuddyView = {
  /** False in halo-only mode (buddy disabled): no buddy, no say, no glance; stops still draw halos. */
  buddy: boolean;
  mode: BuddyMode;
  say: string | null;
  target: { id: string; rect: Rect; style: PointStyle } | null;
  halos: { id: string; rect: Rect; text?: string }[];
};

export function buddyView(s: Buddy, now: number, opts: { enabled: boolean; paused: boolean }): BuddyView {
  const live = expireBuddy(s, now);
  const halos = live.stops.map((p) => ({ id: p.id, rect: p.rect, ...(p.text ? { text: p.text } : {}) }));
  if (!opts.enabled) return { buddy: false, mode: opts.paused ? "paused" : live.mode, say: null, target: null, halos };
  const p = live.glance ?? live.stops[live.stops.length - 1] ?? null;
  return {
    buddy: true,
    mode: opts.paused ? "paused" : live.mode,
    say: live.say?.text ?? null,
    target: p ? { id: p.id, rect: p.rect, style: p.style } : null,
    halos,
  };
}

/**
 * Stop condition for the ~60 fps cursor poll: only while the buddy is enabled and shown, not paused,
 * and there is something to follow (a paired page, or a local bubble such as the 'open the control room' hint).
 */
export function cursorPollNeeded(o: { enabled: boolean; visible: boolean; paused: boolean; paired: boolean; sayActive: boolean }): boolean {
  return o.enabled && o.visible && !o.paused && (o.paired || o.sayActive);
}

/**
 * Bubble placement next to the buddy that never covers the cursor hotspot: right-below by default,
 * flipped left/up when it would leave the display. Coordinates are window DIP.
 */
export function bubblePlacement(
  buddy: { x: number; y: number },
  bubble: { w: number; h: number },
  view: { w: number; h: number },
  gap = 14,
): { x: number; y: number } {
  let x = buddy.x + gap;
  let y = buddy.y + gap;
  if (x + bubble.w > view.w) x = buddy.x - gap - bubble.w;
  if (y + bubble.h > view.h) y = buddy.y - gap - bubble.h;
  return { x: Math.max(0, x), y: Math.max(0, y) };
}
