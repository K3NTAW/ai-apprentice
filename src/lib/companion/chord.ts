// Shortcut learning, web side (protocol v3 'chord'): validation of incoming chords and the link from a chord to
// the vision events it caused. Pure; the capture controller owns the clock and the bus.
import { CHORD_MAX, type ScreenEvent } from "@/lib/types";

/** Rollback switch: false turns off chord handling, the dock and session.state.agent without a revert. */
export const SHORTCUT_LEARNING = true;

/** Vision events received within this many ms after a chord are its effect. */
export const CHORD_LINK_MS = 2000;
export const CHORD_APP_MAX = 200;

const MODIFIERS = new Set(["cmd", "ctrl", "alt", "option"]);
const FKEY = /^f([1-9]|1\d|2[0-4])$/i;

/**
 * True for chords the protocol allows: one with Cmd, Ctrl or Alt/Option, or a function key F1-F24.
 * Plain typing (letters, digits, Shift+letter) is never a chord.
 */
export function isAllowedChord(chord: unknown): chord is string {
  if (typeof chord !== "string" || !chord || chord.length > CHORD_MAX) return false;
  const parts = chord.split("+").map((p) => p.trim());
  if (parts.some((p) => !p)) return false;
  if (parts.some((p) => MODIFIERS.has(p.toLowerCase()))) return true;
  const fkey = parts[parts.length - 1];
  return FKEY.test(fkey) && (parts.length === 1 || (parts.length === 2 && parts[0].toLowerCase() === "shift"));
}

export type ChordIn = { t: number; chord: string; app: string };
/** A closed chord window: the chord, when it was received (session seconds) and its linked vision events. */
export type ClosedChord = { chord: string; app: string; t: number; effects: ScreenEvent[] };

/**
 * Links each chord to the vision events received (bus receive time, ms) within CHORD_LINK_MS after it.
 * Vision events attach to the most recent open chord only; the window closes at CHORD_LINK_MS or at the next chord.
 */
export function createChordLinker(linkMs: number = CHORD_LINK_MS) {
  let open: (ClosedChord & { at: number }) | null = null;

  const close = (): ClosedChord | null => {
    if (!open) return null;
    const done: ClosedChord = { chord: open.chord, app: open.app, t: open.t, effects: open.effects };
    open = null;
    return done;
  };

  return {
    /** Opens a window for a chord; returns the previous chord, now closed. */
    onChord(c: { chord: string; app: string }, at: number, t: number): ClosedChord | null {
      const prev = close();
      open = { chord: c.chord, app: c.app, t, effects: [], at };
      return prev;
    },
    /** A vision event received at `at`. Returns the chord it closed when the window had run out. */
    onVision(ev: ScreenEvent, at: number): ClosedChord | null {
      if (!open) return null;
      if (at - open.at > linkMs) return close();
      open.effects.push(ev);
      return null;
    },
    /** Closes the window once it has run out. */
    poll(at: number): ClosedChord | null {
      return open && at - open.at > linkMs ? close() : null;
    },
    /** Closes the window now (task end). */
    flush: close,
    /** Off the record or pause: drops the pending chord and its links. */
    cancel() {
      open = null;
    },
    pending: () => open !== null,
  };
}
