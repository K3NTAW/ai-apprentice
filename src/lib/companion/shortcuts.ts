// Companion shortcuts (protocol v2) routed to the page's existing controls.
import type { ShortcutAction } from "./client";

/** end_task under this session age asks for confirmation in the page. */
export const END_CONFIRM_MS = 30_000;

export type ShortcutControls = {
  talk(held: boolean): void;
  toggleOffRecord(): void;
  togglePause(): void;
  endTask(): void;
  /** Wall-clock start of the running session; null when nothing runs. */
  startedAt(): number | null;
};

export function routeShortcut(
  action: ShortcutAction,
  c: ShortcutControls,
  { now = Date.now, confirm = (msg: string) => window.confirm(msg) }: { now?: () => number; confirm?: (msg: string) => boolean } = {},
): void {
  const started = c.startedAt();
  if (started === null) return;
  switch (action) {
    case "talk_start":
      return c.talk(true);
    case "talk_end":
      return c.talk(false);
    case "off_record_toggle":
      return c.toggleOffRecord();
    case "pause_toggle":
      return c.togglePause();
    case "end_task":
      if (now() - started < END_CONFIRM_MS && !confirm("This session started less than 30 seconds ago. End it now?")) return;
      return c.endTask();
  }
}
