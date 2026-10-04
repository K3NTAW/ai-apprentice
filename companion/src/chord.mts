// Keyboard shortcut (chord) classifier for protocol v3 'chord' messages. Electron-free.
//
// PRIVACY: this is the ONE module that reads keycodes AND modifier flags of uiohook keydown events
// (shortcuts.mts only compares keyup keycodes with the talk key). classifyChord is a pure function:
// it returns a chord string such as "Cmd+Shift+T" or null, and keeps no key history. Plain typing
// (letters, digits, punctuation, Space, Shift+letter, and Option/AltGr+printable which types characters
// on many layouts) is never returned. Every gate (kill switch, pairing, pause, off the record, buddy
// paused, secure input) is injected, so each one is unit tested.
import type { Platform } from "./shortcuts.mjs";

export type KeyEvent = { key: string; meta: boolean; ctrl: boolean; alt: boolean; shift: boolean };

export type ChordGates = {
  /** COMPANION_CHORDS kill switch. */
  enabled: boolean;
  /** A page is paired (no paired client: nothing to send to). */
  paired: boolean;
  /** Pause sensing (dock or panel). */
  paused: boolean;
  /** session.state.off_record from the page. */
  offRecord: boolean;
  /** buddy.state 'paused' from the page. */
  buddyPaused: boolean;
  /**
   * OS secure input check (macOS IsSecureEventInputEnabled). null = no check on this platform: then only
   * chords with Cmd/Ctrl/Alt are emitted (no bare F-keys). A throw counts as secure (emit nothing).
   */
  secureInput: (() => boolean) | null;
  platform: Platform;
  /** The companion's own accelerators (talk, off record, end task, pause, panel): never emitted. */
  ownBindings: readonly string[];
};

const MODIFIER_KEYS = new Set(["Ctrl", "CtrlRight", "Alt", "AltRight", "Shift", "ShiftRight", "Meta", "MetaRight", "CapsLock", "NumLock", "ScrollLock"]);
/** Keys that only count WITH Cmd/Ctrl/Alt. */
const NEEDS_MODIFIER = new Set(["Escape", "Tab", "Enter", "NumpadEnter"]);
/** Keys that type a character (Option or AltGr plus these is typing, not a shortcut). */
const PRINTABLE_NAMES = new Set([
  "Space",
  "Semicolon",
  "Equal",
  "Comma",
  "Minus",
  "Period",
  "Slash",
  "Backquote",
  "BracketLeft",
  "Backslash",
  "BracketRight",
  "Quote",
]);

const isFunctionKey = (key: string) => /^F([1-9]|1\d|2[0-4])$/.test(key);
const isPrintable = (key: string) => /^[A-Z0-9]$/.test(key) || PRINTABLE_NAMES.has(key) || /^Numpad/.test(key);

/** True when the event has exactly the modifiers and key of an Electron accelerator. */
export function matchesAccelerator(acc: string, ev: KeyEvent, platform: Platform): boolean {
  const parts = acc.split("+");
  const key = parts.pop();
  if (!key || key.toUpperCase() !== ev.key.toUpperCase()) return false;
  const want = { meta: false, ctrl: false, alt: false, shift: false };
  for (const p of parts) {
    const m = p.toLowerCase();
    if (m === "command" || m === "cmd" || m === "super") want.meta = true;
    else if (m === "control" || m === "ctrl") want.ctrl = true;
    else if (m === "option" || m === "alt") want.alt = true;
    else if (m === "shift") want.shift = true;
    else if (m === "commandorcontrol" || m === "cmdorctrl") {
      if (platform === "darwin") want.meta = true;
      else want.ctrl = true;
    } else return false;
  }
  return want.meta === ev.meta && want.ctrl === ev.ctrl && want.alt === ev.alt && want.shift === ev.shift;
}

function label(ev: KeyEvent, platform: Platform): string {
  const mac = platform === "darwin";
  const mods = mac
    ? [ev.meta && "Cmd", ev.ctrl && "Ctrl", ev.alt && "Option", ev.shift && "Shift"]
    : [ev.ctrl && "Ctrl", ev.alt && "Alt", ev.shift && "Shift", ev.meta && "Win"];
  return [...mods.filter(Boolean), ev.key].join("+");
}

/** Pure: the chord string to send, or null. Never throws. */
export function classifyChord(ev: KeyEvent, g: ChordGates): string | null {
  if (!g.enabled || !g.paired || g.paused || g.offRecord || g.buddyPaused) return null;
  let secureKnown = false;
  if (g.secureInput !== null) {
    try {
      if (g.secureInput()) return null;
      secureKnown = true;
    } catch {
      return null;
    }
  }
  if (!ev.key || MODIFIER_KEYS.has(ev.key)) return null;
  const mac = g.platform === "darwin";
  // Cmd counts on macOS only; the Windows key is not a shortcut modifier in protocol v3.
  const command = (mac && ev.meta) || ev.ctrl || ev.alt;
  if (isFunctionKey(ev.key)) {
    if (!command && !secureKnown) return null;
  } else {
    if (!command) return null;
    if (NEEDS_MODIFIER.has(ev.key)) {
      // Escape/Tab/Enter: any of Cmd/Ctrl/Alt is enough.
    } else if (isPrintable(ev.key)) {
      // Option+key (macOS) and Ctrl+Alt+key = AltGr (Windows) type characters such as @ or \ on many layouts.
      if (mac && !ev.meta && !ev.ctrl) return null;
      if (!mac && ev.ctrl && ev.alt && !ev.meta) return null;
    }
  }
  if (g.ownBindings.some((acc) => matchesAccelerator(acc, ev, g.platform))) return null;
  return label(ev, g.platform);
}

/**
 * uiohook 'keydown' listener. Reads keycode and the four modifier flags, maps the keycode to its
 * UiohookKey name, calls emit with the chord or does nothing. Nothing is stored between events.
 */
export function createChordListener(table: Record<string, number>, gates: () => ChordGates, emit: (chord: string) => void): (e: unknown) => void {
  const names = new Map<number, string>();
  for (const [name, code] of Object.entries(table)) if (typeof code === "number" && !names.has(code)) names.set(code, name);
  return (e) => {
    if (typeof e !== "object" || e === null) return;
    const r = e as Record<string, unknown>;
    const key = typeof r.keycode === "number" ? names.get(r.keycode) : undefined;
    if (!key) return;
    const chord = classifyChord({ key, meta: r.metaKey === true, ctrl: r.ctrlKey === true, alt: r.altKey === true, shift: r.shiftKey === true }, gates());
    if (chord) emit(chord);
  };
}

/** Rollback switch: COMPANION_CHORDS=0|off|false|no sends no chord messages. */
export function chordsEnabled(env: string | undefined): boolean {
  return !(env !== undefined && /^(0|off|false|no)$/i.test(env.trim()));
}
