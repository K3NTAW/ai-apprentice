// Global shortcuts: bindings, settings persistence, talk hold detection. Electron-free.
//
// PRIVACY: this is the ONE module allowed to read uiohook keycodes. createKeyUpListener compares the
// keycode of a keyup event against the configured talk binding's key only, returns nothing and keeps no
// history. activity.mts toInputKind stays payload-blind and never sees keyup events.

export const SHORTCUT_ACTIONS = ["talk", "off_record_toggle", "end_task", "pause_toggle", "panel_toggle"] as const;
export type ShortcutAction = (typeof SHORTCUT_ACTIONS)[number];
/** Actions sent to the paired page as {"type":"shortcut","action":...}. panel_toggle stays local. */
export type WireAction = "talk_start" | "talk_end" | "off_record_toggle" | "pause_toggle" | "end_task";
export type Bindings = Record<ShortcutAction, string>;
export type Settings = { bindings: Bindings; buddyEnabled: boolean };
export type Platform = NodeJS.Platform;

/** Hard cap on one talk hold: talk_end is sent after this even if no key-up arrived. */
export const MAX_HOLD_MS = 60_000;
export const NO_PAGE_HINT = "Open the control room to start a session";

export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  talk: "Hold to talk",
  off_record_toggle: "Off the record",
  end_task: "End task",
  pause_toggle: "Pause",
  panel_toggle: "Show panel",
};

export function isShortcutAction(v: unknown): v is ShortcutAction {
  return typeof v === "string" && (SHORTCUT_ACTIONS as readonly string[]).includes(v);
}

/** Option on macOS, Alt elsewhere. Electron accepts 'Option' on macOS and 'Alt' everywhere. */
export function defaultBindings(platform: Platform): Bindings {
  const m = platform === "darwin" ? "Option" : "Alt";
  return {
    talk: `${m}+Space`,
    off_record_toggle: `${m}+Shift+O`,
    end_task: `${m}+Shift+E`,
    pause_toggle: `${m}+Shift+P`,
    panel_toggle: `${m}+Shift+A`,
  };
}

const MODIFIERS: Record<string, string> = {
  option: "Option",
  alt: "Alt",
  shift: "Shift",
  command: "Command",
  cmd: "Command",
  control: "Control",
  ctrl: "Control",
  commandorcontrol: "CommandOrControl",
  cmdorctrl: "CommandOrControl",
  super: "Super",
};
const MOD_ORDER = ["CommandOrControl", "Command", "Control", "Option", "Alt", "Super", "Shift"];

function normalizeKey(k: string): string | null {
  if (/^[a-z0-9]$/i.test(k)) return k.toUpperCase();
  if (/^space$/i.test(k)) return "Space";
  const f = /^f([1-9]|1[0-2])$/i.exec(k);
  return f ? `F${f[1]}` : null;
}

/**
 * Validate and normalise an accelerator: at least one modifier plus one key (A-Z, 0-9, Space, F1-F12).
 * Option and Alt are the same key; they are written as the platform's name. Returns null when invalid.
 */
export function normalizeAccelerator(raw: unknown, platform: Platform): string | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 64) return null;
  const parts = raw.split("+").map((p) => p.trim());
  if (parts.length < 2 || parts.some((p) => p === "")) return null;
  const key = normalizeKey(parts[parts.length - 1]);
  if (!key) return null;
  const mods = new Set<string>();
  for (const p of parts.slice(0, -1)) {
    let m = MODIFIERS[p.toLowerCase()];
    if (!m) return null;
    if (m === "Option" || m === "Alt") m = platform === "darwin" ? "Option" : "Alt";
    if (m === "Command" && platform !== "darwin") return null;
    mods.add(m);
  }
  return [...MOD_ORDER.filter((m) => mods.has(m)), key].join("+");
}

/** Human label for the panel. */
export function displayAccelerator(acc: string, platform: Platform): string {
  return platform === "darwin" ? acc.replace(/\bAlt\b/g, "Option") : acc.replace(/\bOption\b/g, "Alt");
}

/** Parse the settings JSON from userData. Missing, broken, invalid or duplicate entries fall back to defaults. */
export function parseSettings(raw: string | null, platform: Platform): Settings {
  const defaults = defaultBindings(platform);
  let data: unknown = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  const rec = typeof data === "object" && data !== null ? (data as Record<string, unknown>) : {};
  const stored = typeof rec.bindings === "object" && rec.bindings !== null ? (rec.bindings as Record<string, unknown>) : {};
  const bindings = { ...defaults };
  const used = new Set<string>();
  for (const a of SHORTCUT_ACTIONS) {
    const acc = normalizeAccelerator(stored[a], platform);
    if (acc && !used.has(acc)) {
      bindings[a] = acc;
      used.add(acc);
    }
  }
  // A clash with a default left in place falls back to all defaults.
  if (new Set(Object.values(bindings)).size !== SHORTCUT_ACTIONS.length) return { bindings: defaults, buddyEnabled: rec.buddyEnabled !== false };
  return { bindings, buddyEnabled: rec.buddyEnabled !== false };
}

export function serializeSettings(s: Settings): string {
  return JSON.stringify({ bindings: s.bindings, buddyEnabled: s.buddyEnabled }, null, 2);
}

export type SettingsIO = { read(): string | null; write(text: string): void };

/** Settings in a JSON file in userData (main passes fs-backed IO). */
export class SettingsStore {
  private settings: Settings;
  constructor(
    private readonly io: SettingsIO,
    private readonly platform: Platform,
  ) {
    let raw: string | null = null;
    try {
      raw = io.read();
    } catch {
      raw = null;
    }
    this.settings = parseSettings(raw, platform);
  }

  get(): Settings {
    return { bindings: { ...this.settings.bindings }, buddyEnabled: this.settings.buddyEnabled };
  }

  setBinding(action: ShortcutAction, raw: unknown): { ok: true } | { ok: false; reason: string } {
    const acc = normalizeAccelerator(raw, this.platform);
    if (!acc) return { ok: false, reason: "invalid shortcut" };
    const clash = SHORTCUT_ACTIONS.find((a) => a !== action && this.settings.bindings[a] === acc);
    if (clash) return { ok: false, reason: `already used by ${SHORTCUT_LABELS[clash]}` };
    this.settings = { ...this.settings, bindings: { ...this.settings.bindings, [action]: acc } };
    this.save();
    return { ok: true };
  }

  resetBindings(): void {
    this.settings = { ...this.settings, bindings: defaultBindings(this.platform) };
    this.save();
  }

  setBuddyEnabled(on: boolean): void {
    this.settings = { ...this.settings, buddyEnabled: on === true };
    this.save();
  }

  private save(): void {
    this.io.write(serializeSettings(this.settings));
  }
}

/** Rollback switch: COMPANION_BUDDY=0|off|false forces halo-only, whatever the setting says. */
export function buddyEnabled(env: string | undefined, setting: boolean): boolean {
  if (env !== undefined && /^(0|off|false|no)$/i.test(env.trim())) return false;
  return setting;
}

/** While paused only talk is blocked; pause_toggle must always work. */
export function allowedWhilePaused(action: ShortcutAction): boolean {
  return action !== "talk";
}

/** Map a non-talk shortcut to its wire action (talk goes through TalkHold). */
export function wireAction(action: Exclude<ShortcutAction, "talk" | "panel_toggle">): WireAction {
  return action;
}

/**
 * Talk hold. 'hold': press = talk_start, key-up = talk_end, key repeat ignored. 'toggle' (no input hook,
 * so no key-up): press starts, next press ends. Safety: cancel() on unpair, disconnect, pause, lock or
 * hook stop; tick() ends a hold after MAX_HOLD_MS.
 */
export class TalkHold {
  private startedAt: number | null = null;
  constructor(
    private readonly emit: (a: "talk_start" | "talk_end") => void,
    private mode: "hold" | "toggle" = "hold",
    private readonly maxHoldMs = MAX_HOLD_MS,
  ) {}

  setMode(mode: "hold" | "toggle"): void {
    if (mode !== this.mode) this.cancel();
    this.mode = mode;
  }

  getMode(): "hold" | "toggle" {
    return this.mode;
  }

  isHolding(): boolean {
    return this.startedAt !== null;
  }

  press(now: number): void {
    if (this.startedAt !== null) {
      if (this.mode === "toggle") this.cancel();
      return;
    }
    this.startedAt = now;
    this.emit("talk_start");
  }

  release(): void {
    if (this.mode === "hold") this.cancel();
  }

  /** End a running hold (sends talk_end once). No-op when idle. */
  cancel(): void {
    if (this.startedAt === null) return;
    this.startedAt = null;
    this.emit("talk_end");
  }

  tick(now: number): void {
    if (this.startedAt !== null && now - this.startedAt >= this.maxHoldMs) this.cancel();
  }
}

/** The uiohook keycode of a binding's main key, looked up in uiohook-napi's UiohookKey table. */
export function releaseKeycode(accelerator: string, table: Record<string, number>): number | null {
  const key = accelerator.split("+").pop() ?? "";
  const code = Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  return typeof code === "number" ? code : null;
}

/**
 * uiohook 'keyup' listener: reads e.keycode, compares it with the talk binding's key, calls onRelease
 * on a match. Nothing is stored, logged or forwarded.
 */
export function createKeyUpListener(talkKeycode: () => number | null, onRelease: () => void): (e: unknown) => void {
  return (e) => {
    const want = talkKeycode();
    if (want === null || typeof e !== "object" || e === null) return;
    if ((e as { keycode?: unknown }).keycode === want) onRelease();
  };
}
