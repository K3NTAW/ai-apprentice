// Halo validation, store (max count + TTL) and rect mapping. Electron-free.

export const MAX_TEXT = 140;
export const MAX_HALOS = 8;
/** A halo lives at most this long unless the web page re-sends it (same id refreshes the TTL). */
export const HALO_TTL_MS = 30_000;
const MAX_ID = 128;

export type Rect = { x: number; y: number; w: number; h: number };
export type Halo = { id: string; rect: Rect; text?: string };
export type HaloResult = { ok: true; halo: Halo } | { ok: false; reason: string };

const EPS = 1e-9;

function unit(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
}

export function validateRect(r: unknown): { ok: true; rect: Rect } | { ok: false; reason: string } {
  if (typeof r !== "object" || r === null) return { ok: false, reason: "rect_missing" };
  const { x, y, w, h } = r as Record<string, unknown>;
  if (!unit(x) || !unit(y) || !unit(w) || !unit(h)) return { ok: false, reason: "rect_range" };
  if (w <= 0 || h <= 0) return { ok: false, reason: "rect_empty" };
  if (x + w > 1 + EPS || y + h > 1 + EPS) return { ok: false, reason: "rect_overflow" };
  return { ok: true, rect: { x, y, w, h } };
}

/** Clamp bubble text to MAX_TEXT code points. Strips control characters. */
export function clampText(text: string): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u001f\u007f]/g, " ");
  return Array.from(clean).slice(0, MAX_TEXT).join("");
}

export function validateHalo(data: unknown): HaloResult {
  if (typeof data !== "object" || data === null) return { ok: false, reason: "halo_shape" };
  const d = data as Record<string, unknown>;
  if (typeof d.id !== "string" || d.id.length === 0 || d.id.length > MAX_ID) return { ok: false, reason: "halo_id" };
  const rect = validateRect(d.rect);
  if (!rect.ok) return rect;
  const halo: Halo = { id: d.id, rect: rect.rect };
  if (d.text !== undefined) {
    if (typeof d.text !== "string") return { ok: false, reason: "halo_text" };
    const text = clampText(d.text);
    if (text.length > 0) halo.text = text;
  }
  return { ok: true, halo };
}

export type DisplayInfo = { bounds: { x: number; y: number; width: number; height: number }; scaleFactor: number };

/**
 * Map a normalised rect to window coordinates (DIP) of an overlay that covers the display.
 * Edges are snapped to whole device pixels so the halo is crisp at any scale factor.
 */
export function mapRect(rect: Rect, display: DisplayInfo): Rect {
  const s = display.scaleFactor > 0 && Number.isFinite(display.scaleFactor) ? display.scaleFactor : 1;
  const { width, height } = display.bounds;
  const snap = (v: number) => Math.round(v * s) / s;
  const left = snap(rect.x * width);
  const top = snap(rect.y * height);
  const right = snap((rect.x + rect.w) * width);
  const bottom = snap((rect.y + rect.h) * height);
  return { x: left, y: top, w: right - left, h: bottom - top };
}

type Entry = { halo: Halo; expires: number };

/** Active halos keyed by id. Oldest is evicted past MAX_HALOS. */
export class HaloStore {
  private entries = new Map<string, Entry>();
  constructor(private ttlMs = HALO_TTL_MS, private max = MAX_HALOS) {}

  upsert(halo: Halo, now: number): void {
    this.entries.delete(halo.id);
    this.entries.set(halo.id, { halo, expires: now + this.ttlMs });
    while (this.entries.size > this.max) {
      const oldest = this.entries.keys().next().value as string;
      this.entries.delete(oldest);
    }
  }

  /** Clear one id, or all when id is undefined. Returns true if anything changed. */
  clear(id?: string): boolean {
    if (id === undefined) {
      const had = this.entries.size > 0;
      this.entries.clear();
      return had;
    }
    return this.entries.delete(id);
  }

  /** Drop expired halos. Returns true if anything changed. */
  expire(now: number): boolean {
    let changed = false;
    for (const [id, e] of this.entries) {
      if (e.expires <= now) {
        this.entries.delete(id);
        changed = true;
      }
    }
    return changed;
  }

  list(): Halo[] {
    return [...this.entries.values()].map((e) => e.halo);
  }
}

export type OverlayViewInput<V extends { target: { rect: Rect } | null; halos: Halo[] }, A> = {
  view: V;
  avatar: A;
  /** Rects are normalised to the primary display, so halos and pointing targets draw only there. */
  isPrimary: boolean;
  display: DisplayInfo;
  /** session.state off_record, the same source the dock uses. */
  offRecord: boolean;
};

/**
 * What one overlay window draws. Off the record nothing on screen points at the user's work: no target
 * (so no flight and no dotted path) and no halos; the flag is passed on so overlay.js clears a running path.
 */
export function overlayViewModel<V extends { target: { rect: Rect } | null; halos: Halo[] }, A>(input: OverlayViewInput<V, A>) {
  const { view, display, offRecord } = input;
  const draw = input.isPrimary && !offRecord;
  return {
    ...view,
    avatar: input.avatar,
    offRecord,
    target: draw && view.target ? { ...view.target, rect: mapRect(view.target.rect, display) } : null,
    halos: draw ? view.halos.map((h) => ({ ...h, rect: mapRect(h.rect, display) })) : [],
  };
}
