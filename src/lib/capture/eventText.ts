// Screen events in natural words for the capture console's live events table and the dock feed (Capture.dc.html):
// verb first, no app name (the row's app tag carries it), never a quoted raw string.
// A shortcut row says what the chord did, from the vision events linked to it (effect_ids), with the chord as keycaps;
// without a known effect it reads '<App>: shortcut'. Pure.
import type { ScreenEvent } from "@/lib/types";

export type EventText = {
  text: string;
  /** shortcut_used only: the chord to show as keycaps on the right. */
  chord?: string;
};

const pretty = (s: string) => s.replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
// item_sent field -> verb; any other field is shown in brackets after 'Sent'.
const SENT_VERBS: Record<string, string> = { send: "Sent", sent: "Sent", forward: "Forwarded", reply: "Replied with", "reply all": "Replied to all with" };
const object = (e: Pick<ScreenEvent, "entity">) => pretty(`${e.entity.kind} ${e.entity.id}`);

function change(e: ScreenEvent, what: string): string {
  if (e.from !== undefined && e.to !== undefined) return `Changed ${what}: ${e.from} → ${e.to}`;
  if (e.to !== undefined) return `Set ${what} to ${e.to}`;
  if (e.from !== undefined) return `Cleared ${what} (was ${e.from})`;
  return `Changed ${what}`;
}

/** One vision, dom or os event in words, e.g. 'Opened ERP tab · supplier 20418'. Shortcuts without effects: '<App>: shortcut'. */
function phrase(e: ScreenEvent): string {
  const obj = object(e);
  const field = e.field ? pretty(e.field) : undefined;
  switch (e.type) {
    case "field_changed":
      return change(e, field ? `${field} for ${obj}` : obj);
    case "status_changed":
      return change(e, `status of ${obj}`);
    case "record_opened":
      return `Opened ${e.window ? `${pretty(e.window)} · ` : ""}${obj}`;
    case "button_clicked":
      return `Clicked ${field ?? (e.to !== undefined ? pretty(e.to) : "a button")} on ${obj}`;
    case "app_switched":
      return `Switched to ${e.app ?? pretty(e.entity.id)}${e.window ? ` · ${pretty(e.window)}` : ""}`;
    case "text_entered":
      return `Typed ${field ?? "text"} in ${obj}`;
    case "item_created":
      return `Created ${obj}`;
    case "item_sent": {
      const verb = SENT_VERBS[field?.toLowerCase() ?? "send"];
      const to = e.to !== undefined ? ` to ${e.to}` : "";
      return verb ? `${verb} ${obj}${to}` : `Sent ${obj}${to} (${field})`;
    }
    case "item_deleted":
      return `Deleted ${obj}`;
    case "navigated":
      return `Went to ${obj}`;
    case "shortcut_used":
      return `${e.app ?? pretty(e.entity.id)}: shortcut`;
  }
}

/**
 * The row text for one event. `events` are the events around it (the feed); a shortcut's effect_ids resolve
 * against them, and the first linked effect found becomes the row's words.
 */
export function eventText(event: ScreenEvent, events: readonly ScreenEvent[] = []): EventText {
  if (event.type !== "shortcut_used") return { text: phrase(event) };
  const ids = event.effect_ids ?? [];
  const effect = ids.map((id) => events.find((e) => e.id === id && e.type !== "shortcut_used")).find(Boolean);
  return { text: effect ? phrase(effect) : phrase(event), ...(event.chord ? { chord: event.chord } : {}) };
}
