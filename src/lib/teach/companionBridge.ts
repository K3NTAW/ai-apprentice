// Teach -> desktop companion (protocol v2): guardrail stops become buddy.point style 'stop' (replaces the
// overlay.halo call) and companion shortcuts map to the Teach controls. Framework free.
import type {
  CompanionActivityMsg,
  CompanionChordMsg,
  CompanionClient,
  CompanionPermissions,
  CompanionStatus,
  ShortcutAction,
} from "@/lib/companion/client";
import type { ShortcutControls } from "@/lib/companion/shortcuts";
import type { CompanionTransport } from "@/lib/companion/transport";
import type { HaloSink } from "./intervention";

export type TeachBuddy = Pick<CompanionClient, "buddyPoint" | "buddyClear">;

/** HaloSink for the intervention engine: 'stop' point with the guardrail bubble, buddy.clear when resolved. */
export function stopPointSink(buddy: () => TeachBuddy | null, enabled: () => boolean = () => true): HaloSink {
  return {
    showHalo: (id, rect, text) => enabled() && (buddy()?.buddyPoint({ id, rect, style: "stop", text }) ?? false),
    clearHalo: (id) => buddy()?.buddyClear(id) ?? false,
  };
}

/** Teach has no separate off-record mode: off_record_toggle and pause_toggle both pause the tutor. */
export function teachShortcutControls(c: {
  talk(held: boolean): void;
  togglePause(): void;
  finish(): void;
  startedAt(): number | null;
}): ShortcutControls {
  return {
    talk: c.talk,
    toggleOffRecord: c.togglePause,
    togglePause: c.togglePause,
    endTask: c.finish,
    startedAt: c.startedAt,
  };
}

/**
 * Subscribes Teach to the companion transport (one-app D2); returns one unsubscribe for all.
 * Activity and chords are passed on only while a teach session runs (active()), never stored here.
 */
export function bindTeachTransport(
  t: CompanionTransport,
  h: {
    active(): boolean;
    onStatus(s: CompanionStatus, perms: CompanionPermissions | null): void;
    onActivity(a: CompanionActivityMsg): void;
    onChord(c: CompanionChordMsg): void;
    onShortcut(a: ShortcutAction): void;
  },
): () => void {
  const offs = [
    t.on("status", (s, perms) => h.onStatus(s, perms)),
    t.on("activity", (a) => h.active() && h.onActivity(a)),
    t.on("chord", (c) => h.active() && h.onChord(c)),
    t.on("shortcut", (a) => h.onShortcut(a)),
  ];
  return () => {
    for (const off of offs) off();
  };
}
