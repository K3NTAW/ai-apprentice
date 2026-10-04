import { describe, expect, it } from "vitest";
import { ALL_SCREEN_EVENT_TYPES, type ScreenEvent } from "@/lib/types";
import { eventText } from "./eventText";

const OUTLOOK = "Microsoft Outlook";
const ev = (x: Partial<ScreenEvent>): ScreenEvent => ({
  id: "e",
  t: 1,
  source: "vision",
  type: "record_opened",
  entity: { kind: "supplier", id: "20418" },
  app: "Google Chrome",
  ...x,
});
const chord = (x: Partial<ScreenEvent> = {}) =>
  ev({ id: "k", source: "os", type: "shortcut_used", entity: { kind: "app", id: OUTLOOK }, app: OUTLOOK, chord: "Cmd+J", ...x });

describe("eventText: shortcuts", () => {
  const forwarded = ev({ id: "v1", type: "item_sent", entity: { kind: "mail", id: "" }, field: "forward", to: "controller", app: OUTLOOK });

  it("shows the linked effect in words with the chord as keycaps", () => {
    expect(eventText(chord({ effect_ids: ["v1"] }), [forwarded])).toEqual({ text: "Forwarded mail to controller", chord: "Cmd+J" });
  });

  it("without a known effect reads '<App>: shortcut'", () => {
    expect(eventText(chord())).toEqual({ text: `${OUTLOOK}: shortcut`, chord: "Cmd+J" });
    // effect ids that are not in the feed (yet)
    expect(eventText(chord({ effect_ids: ["gone"] }), [forwarded])).toEqual({ text: `${OUTLOOK}: shortcut`, chord: "Cmd+J" });
    expect(eventText(chord({ app: undefined }))).toEqual({ text: `${OUTLOOK}: shortcut`, chord: "Cmd+J" });
  });

  it("never shows the quoted raw string", () => {
    const { text } = eventText(chord());
    expect(text).not.toMatch(/["“”]/);
    expect(text).not.toContain("pressed");
  });
});

describe("eventText: natural phrasing per event type", () => {
  const inv = { kind: "invoice", id: "4517" };
  const offer = { kind: "email", id: "Offer Q3" };
  const CASES: Record<(typeof ALL_SCREEN_EVENT_TYPES)[number], [Partial<ScreenEvent>, string][]> = {
    record_opened: [
      [{ window: "ERP tab" }, "Opened ERP tab · supplier 20418"],
      [{}, "Opened supplier 20418"],
    ],
    field_changed: [
      [{ entity: inv, field: "cost_center", from: "4711", to: "0400" }, "Changed cost center for invoice 4517: 4711 → 0400"],
      [{ entity: inv, field: "cost center", to: "0400" }, "Set cost center for invoice 4517 to 0400"],
      [{ entity: inv, field: "cost center", from: "4711" }, "Cleared cost center for invoice 4517 (was 4711)"],
      [{ entity: inv }, "Changed invoice 4517"],
    ],
    status_changed: [[{ entity: inv, from: "open", to: "approved" }, "Changed status of invoice 4517: open → approved"]],
    button_clicked: [
      [{ entity: inv, field: "Approve" }, "Clicked Approve on invoice 4517"],
      [{ entity: inv }, "Clicked a button on invoice 4517"],
    ],
    app_switched: [
      [{ source: "os", entity: { kind: "app", id: OUTLOOK }, app: OUTLOOK }, `Switched to ${OUTLOOK}`],
      [{ source: "os", entity: { kind: "app", id: OUTLOOK }, app: OUTLOOK, window: "Inbox" }, `Switched to ${OUTLOOK} · Inbox`],
    ],
    text_entered: [[{ entity: offer, field: "subject" }, "Typed subject in email Offer Q3"]],
    item_created: [[{ entity: { kind: "slide", id: "4" } }, "Created slide 4"]],
    item_sent: [
      [{ entity: offer, to: "Sabine" }, "Sent email Offer Q3 to Sabine"],
      [{ entity: offer, field: "send" }, "Sent email Offer Q3"],
      [{ entity: offer, field: "archive copy" }, "Sent email Offer Q3 (archive copy)"],
    ],
    item_deleted: [[{ entity: { kind: "file", id: "draft.xlsx" } }, "Deleted file draft.xlsx"]],
    navigated: [[{ entity: { kind: "slide", id: "2" } }, "Went to slide 2"]],
    shortcut_used: [
      [{ source: "os", entity: { kind: "app", id: "Microsoft Excel" }, app: "Microsoft Excel", chord: "Cmd+D" }, "Microsoft Excel: shortcut"],
    ],
  };

  for (const type of ALL_SCREEN_EVENT_TYPES)
    it(type, () => {
      expect(CASES[type].length).toBeGreaterThan(0);
      for (const [x, want] of CASES[type]) {
        const { text } = eventText(ev({ ...x, type }));
        expect(text).toBe(want);
        // no quotes and no trailing 'in <app>': the row's app tag carries the app
        expect(text).not.toMatch(/["“”]/);
        expect(text).not.toMatch(/ in Google Chrome$/);
      }
    });
});
