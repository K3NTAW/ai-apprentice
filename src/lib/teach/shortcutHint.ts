// Teach shortcut hint (agents wave A5): when the learner does a step the slow way, the tutor names the
// expert's shortcut once. Pure apart from the injected clock.
import type { ScreenEvent, WorkMap, WorkMapStep } from "@/lib/types";
import { shortcutKey } from "@/lib/decide/shortcut";
import { shortcutSuggestion } from "@/lib/voice/prompts";

/** A learner chord within this many ms before the effect means they used the shortcut. */
export const SHORTCUT_QUIET_MS = 10_000;

export type ShortcutHint = { chord: string; app: string; text: string };

/**
 * Slow path: inside the current step, a screen event (not os) of the shortcut's effect_type appears and the
 * learner did not press that chord in the last SHORTCUT_QUIET_MS. Suggested once per session per chord+app.
 * While `busy` (a stop is active or the tutor is within its cooldown) nothing is suggested and nothing is used up.
 */
export function createShortcutCoach({ workmap, now = Date.now }: { workmap: WorkMap; now?: () => number }) {
  const chords = new Map<string, number>();
  const suggested = new Set<string>();

  return {
    /** A chord the learner pressed (protocol v3 'chord'). */
    noteChord(chord: string) {
      chords.set(chord.trim().toLowerCase(), now());
    },
    onEvent(ev: ScreenEvent, step: WorkMapStep | null, { busy = false }: { busy?: boolean } = {}): ShortcutHint | null {
      if (!step || ev.source === "os" || busy) return null;
      for (const sc of workmap.shortcuts ?? []) {
        if (sc.step !== step.n || !sc.effect_type || sc.effect_type !== ev.type) continue;
        const key = shortcutKey(sc.chord, sc.app);
        if (suggested.has(key)) continue;
        const at = chords.get(sc.chord.trim().toLowerCase());
        if (at !== undefined && now() - at <= SHORTCUT_QUIET_MS) continue;
        suggested.add(key);
        return { chord: sc.chord, app: sc.app, text: shortcutSuggestion(workmap.expert, sc.chord) };
      }
      return null;
    },
  };
}

export type ShortcutCoach = ReturnType<typeof createShortcutCoach>;
