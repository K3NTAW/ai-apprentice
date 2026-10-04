// Idle cost controls for the main process: CPU logging (COMPANION_PERF=1), cursor polling, poll timers,
// overlay visibility and send dedupe. Electron-free: main.mts injects the clock, timers and readers.
import type { BuddyMode } from "./buddy.mjs";

export const PERF_LOG_MS = 5_000;
/** At most 30 Hz. */
export const CURSOR_POLL_MS = 34;
/** The cursor poll pauses after this long without movement and resumes on the next uiohook mousemove. */
export const CURSOR_IDLE_MS = 2_000;
export const APP_POLL_ACTIVE_MS = 500;
export const APP_POLL_IDLE_MS = 5_000;
export const PERMISSION_POLL_MS = 10_000;
/** Throttling returns this long after the last session or voice activity. */
export const THROTTLE_GRACE_MS = 30_000;

export function perfEnabled(value: string | undefined): boolean {
  return value === "1";
}

type Metric = { pid: number; type: string; name?: string; cpu: { percentCPUUsage: number } };

/** One log line from app.getAppMetrics(): total and per-process CPU percent, e.g. "cpu 3.1% | Browser 1.2 | GPU 1.9". */
export function formatMetrics(metrics: Metric[]): string {
  const r = (n: number) => (Math.round(n * 10) / 10).toFixed(1);
  const total = metrics.reduce((s, m) => s + (Number.isFinite(m.cpu.percentCPUUsage) ? m.cpu.percentCPUUsage : 0), 0);
  const parts = metrics.map((m) => `${m.name || m.type}:${m.pid} ${r(m.cpu.percentCPUUsage || 0)}`);
  return `cpu ${r(total)}% | ${parts.join(" | ")}`;
}

export type TimerApi = {
  setInterval(fn: () => void, ms: number): unknown;
  clearInterval(handle: unknown): void;
};

/** A repeating timer whose period can change; set(null) stops it. Restarts only when the period changes. */
export class RepeatingTimer {
  private handle: unknown = null;
  private period: number | null = null;
  constructor(
    private readonly timers: TimerApi,
    private readonly fn: () => void,
  ) {}

  set(ms: number | null): void {
    if (ms === this.period) return;
    if (this.handle !== null) this.timers.clearInterval(this.handle);
    this.handle = null;
    this.period = ms;
    if (ms !== null) this.handle = this.timers.setInterval(this.fn, ms);
  }

  get ms(): number | null {
    return this.period;
  }
}

/** Every main-process timer, so quit clears them all. */
export class TimerSet {
  private readonly all: RepeatingTimer[] = [];
  constructor(private readonly timers: TimerApi) {}

  add(fn: () => void, ms: number | null = null): RepeatingTimer {
    const t = new RepeatingTimer(this.timers, fn);
    t.set(ms);
    this.all.push(t);
    return t;
  }

  clearAll(): void {
    for (const t of this.all) t.set(null);
  }
}

/** A session is active while a page is connected and session.state has a mode (capture or teach). */
export function sessionActive(o: { paired: boolean; mode: "capture" | "teach" | null | undefined }): boolean {
  return o.paired && (o.mode === "capture" || o.mode === "teach");
}

/** Frontmost app: every 500 ms during a session, every 5 s otherwise. */
export function appPollMs(active: boolean): number {
  return active ? APP_POLL_ACTIVE_MS : APP_POLL_IDLE_MS;
}

/** Permission poll: every 10 s, only while one of them is missing. */
export function permissionPollMs(p: { input: boolean; screen: boolean; accessibility: boolean }): number | null {
  return p.input && p.screen && p.accessibility ? null : PERMISSION_POLL_MS;
}

/** Main window: background throttling off only during a session (voice and frames keep running). */
export function allowThrottling(active: boolean): boolean {
  return !active;
}

const VOICE_MODES: readonly BuddyMode[] = ["listening", "thinking", "speaking"];

/**
 * Voice or session activity that needs an unthrottled main window: a capture/teach session, or a voice
 * session without a mode (e.g. the debrief interview), seen as buddy.state listening/thinking/speaking or
 * session.state voice_active.
 */
export function voiceSessionActive(o: { paired: boolean; mode: "capture" | "teach" | null | undefined; buddyMode: BuddyMode; voiceActive: boolean }): boolean {
  if (!o.paired) return false;
  return sessionActive(o) || o.voiceActive || VOICE_MODES.includes(o.buddyMode);
}

export type TimeoutApi = {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
};

/**
 * Main window background throttling: off at once while active, back on THROTTLE_GRACE_MS after the last
 * activity (a pause between turns does not throttle the voice). apply(allow) runs on every update; it must be idempotent.
 */
export class ThrottleGate {
  private allow = true;
  private pending: unknown = null;
  constructor(
    private readonly timers: TimeoutApi,
    private readonly apply: (allow: boolean) => void,
  ) {}

  get allowed(): boolean {
    return this.allow;
  }

  update(active: boolean): void {
    if (active) {
      this.cancel();
      this.allow = false;
    } else if (!this.allow && this.pending === null) {
      this.pending = this.timers.setTimeout(() => {
        this.pending = null;
        this.allow = true;
        this.apply(true);
      }, THROTTLE_GRACE_MS);
    }
    this.apply(this.allow);
  }

  cancel(): void {
    if (this.pending !== null) this.timers.clearTimeout(this.pending);
    this.pending = null;
  }
}

/**
 * Overlay window shown only when it draws something: never in capture mode (the buddy is hidden there),
 * otherwise while the buddy is shown and has something to follow, or while this display has halos.
 */
export function overlayShown(o: { mode: "capture" | "teach" | null | undefined; buddy: boolean; follow: boolean; target: boolean; halos: number }): boolean {
  if (o.mode === "capture") return false;
  return o.halos > 0 || (o.buddy && (o.follow || o.target));
}

/** Remembers the last value sent per channel; changed() is true (and records it) only for a new value. */
export class SendGate {
  private readonly last = new Map<string, string>();

  changed(key: string, value: unknown): boolean {
    const json = JSON.stringify(value) ?? "undefined";
    if (this.last.get(key) === json) return false;
    this.last.set(key, json);
    return true;
  }

  forget(prefix: string): void {
    for (const k of [...this.last.keys()]) if (k.startsWith(prefix)) this.last.delete(k);
  }
}

type Point = { x: number; y: number };

/**
 * Cursor poll for the buddy: runs only while needed, at most 30 Hz, pauses after CURSOR_IDLE_MS without
 * movement and resumes on moved() (uiohook mousemove). Without the hook (canResume false) it never pauses.
 */
export class CursorPoller {
  private readonly timer: RepeatingTimer;
  private need = false;
  private idle = false;
  private last: Point | null = null;
  private stillSince = 0;

  constructor(
    timers: TimerApi,
    private readonly o: { now: () => number; read: () => Point; push: (p: Point) => void; canResume: () => boolean },
  ) {
    this.timer = new RepeatingTimer(timers, () => this.tick());
  }

  get running(): boolean {
    return this.timer.ms !== null;
  }

  get paused(): boolean {
    return this.need && this.idle;
  }

  set(need: boolean): void {
    this.need = need;
    if (!need) {
      this.idle = false;
      this.last = null;
    }
    this.sync();
  }

  moved(): void {
    if (!this.idle) return;
    this.idle = false;
    this.stillSince = this.o.now();
    this.sync();
  }

  tick(): void {
    const p = this.o.read();
    const now = this.o.now();
    if (this.last && this.last.x === p.x && this.last.y === p.y) {
      if (now - this.stillSince >= CURSOR_IDLE_MS && this.o.canResume()) {
        this.idle = true;
        this.sync();
      }
      return;
    }
    this.last = p;
    this.stillSince = now;
    this.o.push(p);
  }

  private sync(): void {
    this.timer.set(this.need && !this.idle ? CURSOR_POLL_MS : null);
  }
}

export type OverlayWin = {
  isDestroyed(): boolean;
  isVisible(): boolean;
  showInactive(): void;
  hide(): void;
  webContents: { send(channel: string, ...args: unknown[]): void };
};
type OverlayModel = { buddy: boolean; target: unknown; halos: unknown[] };

/**
 * One pass over the overlay windows. Visibility first (overlayShown, following the cursor when wanted); the cursor
 * loop runs only while some overlay is shown and is set before any view is sent, so the view that wakes the
 * overlay's rAF animation already has a cursor feed. Shown windows use showInactive (never take focus); the
 * others are hidden and get a null cursor, which stops both the poll and the animation. Returns whether the cursor loop runs.
 */
export function syncOverlayWindows<M extends OverlayModel>(o: {
  overlays: Iterable<[number, OverlayWin]>;
  ready: (win: OverlayWin) => boolean;
  mode: "capture" | "teach" | null | undefined;
  /** The buddy wants the cursor (cursorPollNeeded). */
  wantCursor: boolean;
  model: (id: number) => M;
  cursor: { set(need: boolean): void };
  sent: SendGate;
}): boolean {
  const frames = [...o.overlays]
    .filter(([, win]) => !win.isDestroyed())
    .map(([id, win]) => {
      const model = o.model(id);
      const shown = overlayShown({ mode: o.mode, buddy: model.buddy, follow: o.wantCursor, target: model.target !== null, halos: model.halos.length });
      return { id, win, model, shown };
    });
  const need = o.wantCursor && frames.some((f) => f.shown);
  o.cursor.set(need);
  for (const { id, win, model, shown } of frames) {
    if (!need && o.sent.changed(`cursor:${id}`, null)) win.webContents.send("cursor", null);
    if (o.sent.changed(`view:${id}`, model)) win.webContents.send("buddy-view", model);
    // An empty overlay is hidden, not just transparent: full-screen transparent windows are costly to composite.
    if (shown && o.ready(win) && !win.isVisible()) win.showInactive();
    if (!shown && win.isVisible()) win.hide();
  }
  return need;
}
