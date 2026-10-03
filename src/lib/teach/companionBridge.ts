// Teach -> desktop companion (protocol v2): guardrail stops become buddy.point style 'stop' (replaces the
// overlay.halo call) and companion shortcuts map to the Teach controls. Framework free.
import type { CompanionClient } from "@/lib/companion/client";
import type { ShortcutControls } from "@/lib/companion/shortcuts";
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
