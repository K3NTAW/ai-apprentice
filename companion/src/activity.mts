// Activity aggregation into 500 ms windows. Electron-free.
// PRIVACY: the aggregator only ever sees the event KIND. Key codes, characters and positions
// are dropped at the adapter boundary (toInputKind) and never reach this module's state.
import type { ActivityMessage } from "./protocol.mjs";

export const WINDOW_MS = 500;

export type InputKind = "key" | "click" | "move" | "wheel";

const HOOK_EVENT_KINDS: Record<string, InputKind> = {
  keydown: "key",
  mousedown: "click",
  mousemove: "move",
  wheel: "wheel",
};

/**
 * Adapter boundary for uiohook events. Takes the event name and IGNORES the payload
 * (keycode, rawcode, x, y, button...): only the kind leaves this function.
 */
export function toInputKind(eventName: string, _payload?: unknown): InputKind | null {
  return Object.prototype.hasOwnProperty.call(HOOK_EVENT_KINDS, eventName) ? HOOK_EVENT_KINDS[eventName] : null;
}

export class ActivityAggregator {
  private keys = 0;
  private clicks = 0;
  private pointer = false;
  private lastInput: number | null = null;

  constructor(private startedAt: number) {}

  record(kind: InputKind, t: number): void {
    if (kind === "key") this.keys += 1;
    else if (kind === "click") {
      this.clicks += 1;
      this.pointer = true;
    } else this.pointer = true;
    if (this.lastInput === null || t > this.lastInput) this.lastInput = t;
  }

  /** Close the current window and return its activity message. Resets the counts. */
  flush(now: number): ActivityMessage {
    const since = this.lastInput ?? this.startedAt;
    const msg: ActivityMessage = {
      type: "activity",
      t: now,
      typing: this.keys > 0,
      pointer: this.pointer,
      keys: this.keys,
      clicks: this.clicks,
      idle_ms: Math.max(0, Math.round(now - since)),
    };
    this.keys = 0;
    this.clicks = 0;
    this.pointer = false;
    return msg;
  }

  /** Forget everything (used on pause). */
  reset(now: number): void {
    this.keys = 0;
    this.clicks = 0;
    this.pointer = false;
    this.lastInput = null;
    this.startedAt = now;
  }
}

/** Emit 'app' only when app or title changed. */
export class AppChangeTracker {
  private last: string | null = null;
  changed(app: string, title: string): boolean {
    const key = JSON.stringify([app, title]);
    if (key === this.last) return false;
    this.last = key;
    return true;
  }
  reset(): void {
    this.last = null;
  }
}
