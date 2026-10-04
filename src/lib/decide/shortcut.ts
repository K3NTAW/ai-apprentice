// Shortcut questions (agents wave A5): which shortcut the interviewer asks about, and the live cap.
// Deterministic code, no paid call: a shortcut is a judgment-call candidate when the expert repeats it
// or when its linked effect changes state. Pure apart from the injected clock.

/** Repeat rule: at least this many uses of the same chord in the same app ... */
export const SHORTCUT_REPEAT_N = 3;
/** ... within this window (session seconds). */
export const SHORTCUT_REPEAT_WINDOW_S = 10 * 60;
/** At most one shortcut question live per this many ms; the rest go to the debrief gap list. */
export const SHORTCUT_ASK_GAP_MS = 3 * 60 * 1000;
/** Effect types that change state. field_changed only counts with move or approve semantics. */
export const STATE_CHANGING_EFFECTS = ["item_sent", "item_deleted", "status_changed", "field_changed"] as const;
const MOVE_OR_APPROVE = /\b(move[ds]?|moving|folder|approv\w*|archiv\w*|assign\w*|stage|owner|status)\b/i;

type SEvent = { type?: string; t?: number; chord?: string; app?: string; field?: string; to?: string };

export const shortcutKey = (chord: string | undefined, app: string | undefined) =>
  `${(chord ?? "").trim().toLowerCase()}|${(app ?? "").trim().toLowerCase()}`;

export function isStateChangingEffect(e: SEvent | undefined): boolean {
  if (!e?.type || !(STATE_CHANGING_EFFECTS as readonly string[]).includes(e.type)) return false;
  if (e.type !== "field_changed") return true;
  return MOVE_OR_APPROVE.test(`${e.field ?? ""} ${e.to ?? ""}`.replace(/[_-]+/g, " "));
}

/** Uses of the event's chord+app within SHORTCUT_REPEAT_WINDOW_S up to and including the event (earlier uses by t). */
export function shortcutUses(event: SEvent, history: SEvent[]): number {
  const key = shortcutKey(event.chord, event.app);
  const t = event.t ?? 0;
  const prior = history.filter(
    (h) => h.type === "shortcut_used" && shortcutKey(h.chord, h.app) === key && typeof h.t === "number" && t - h.t > 0 && t - h.t <= SHORTCUT_REPEAT_WINDOW_S,
  );
  return prior.length + 1;
}

export type ShortcutVerdict = { candidate: boolean; why: "state_change" | "repeated" | "routine" };

/**
 * A shortcut is a judgment-call candidate when its linked effect changes state, or on its
 * SHORTCUT_REPEAT_N-th use within the window. With no linked effect (yet), only the repeat rule applies.
 */
export function shortcutVerdict(event: SEvent, effects: SEvent[], history: SEvent[]): ShortcutVerdict {
  if (event.type !== "shortcut_used") return { candidate: false, why: "routine" };
  if (effects.some(isStateChangingEffect)) return { candidate: true, why: "state_change" };
  if (shortcutUses(event, history) >= SHORTCUT_REPEAT_N) return { candidate: true, why: "repeated" };
  return { candidate: false, why: "routine" };
}

/** Live cap for shortcut questions; its own counter, on top of the ask gate's global budget and gap. */
export function createShortcutAskCap({ now = Date.now, gapMs = SHORTCUT_ASK_GAP_MS }: { now?: () => number; gapMs?: number } = {}) {
  let last = -Infinity;
  const asked = new Set<string>();
  return {
    /** False within gapMs of the last shortcut question, or when this chord+app was already asked about. */
    canAsk(key?: string): boolean {
      if (key !== undefined && asked.has(key)) return false;
      return now() - last >= gapMs;
    },
    markAsked(key?: string) {
      last = now();
      if (key !== undefined) asked.add(key);
    },
  };
}
