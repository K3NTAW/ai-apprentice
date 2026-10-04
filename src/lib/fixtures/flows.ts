// Test fixtures: two real-work flows in everyday apps, plus a navigation-only session.
// Email flow (Outlook): open a mail from a vendor, forward it to the controller, flag it.
// Slide flow (PowerPoint): delete a slide, change a number on another slide.
import type { ScreenEvent, Session } from "@/lib/types";

export const OUTLOOK = "Microsoft Outlook";
export const POWERPOINT = "Microsoft PowerPoint";

const mail = { kind: "email", id: "Offer Q3 from Muster AG" };

export const emailEvents: ScreenEvent[] = [
  { id: "m0", t: 5, source: "os", type: "app_switched", entity: { kind: "app", id: OUTLOOK }, app: OUTLOOK, window: "Inbox - Outlook" },
  {
    id: "m1", t: 10, source: "vision", type: "record_opened", entity: mail, app: OUTLOOK, window: "Inbox - Outlook",
    rect: { x: 0.3, y: 0.18, w: 0.4, h: 0.05 }, frame_ref: "frames/0010.jpg",
  },
  {
    id: "m2", t: 30, source: "vision", type: "item_sent", entity: mail, app: OUTLOOK, window: "FW: Offer Q3 - Message",
    field: "forward", to: "controller@example.com", rect: { x: 0.02, y: 0.1, w: 0.06, h: 0.04 }, frame_ref: "frames/0030.jpg",
  },
  {
    id: "m3", t: 40, source: "vision", type: "button_clicked", entity: mail, app: OUTLOOK, window: "Inbox - Outlook",
    field: "flag", rect: { x: 0.68, y: 0.18, w: 0.02, h: 0.03 }, frame_ref: "frames/0040.jpg",
  },
];

export function emailFlowSession(): Session {
  return {
    id: "s_email",
    kind: "capture",
    started_at: "2026-10-03T09:00:00.000Z",
    expert: "Anna Muster",
    events: emailEvents.map((e) => ({ ...e })),
    transcript: [
      { id: "t1", t: 32, speaker: "expert", text: "Offers above ten thousand always go to the controller first.", phase: "capture", redacted: true },
      { id: "t2", t: 42, speaker: "expert", text: "I flag it so I chase it on Friday.", phase: "capture", redacted: true },
    ],
    qa: [
      {
        id: "q1", t_question: 33, t_answer: 35, question: "Why did you forward it?",
        answer: "Offers above ten thousand always go to the controller first.", event_id: "m2", phase: "capture", about: "reason",
      },
      {
        id: "q2", t_question: 300, t_answer: 305, question: "When would you not forward it?",
        answer: "If the controller is away, ask the deputy before replying.", event_id: "m2", phase: "debrief", about: "guardrail",
      },
    ],
    off_record_ranges: [],
  };
}

export const slideEvents: ScreenEvent[] = [
  { id: "p0", t: 5, source: "os", type: "app_switched", entity: { kind: "app", id: POWERPOINT }, app: POWERPOINT, window: "Board update.pptx" },
  { id: "p1", t: 8, source: "vision", type: "navigated", entity: { kind: "slide", id: "4" }, app: POWERPOINT, window: "Board update.pptx" },
  {
    id: "p2", t: 15, source: "vision", type: "item_deleted", entity: { kind: "slide", id: "4" }, app: POWERPOINT,
    window: "Board update.pptx", rect: { x: 0.01, y: 0.4, w: 0.12, h: 0.08 }, frame_ref: "frames/0015.jpg",
  },
  {
    id: "p3", t: 25, source: "vision", type: "field_changed", entity: { kind: "slide", id: "2" }, app: POWERPOINT,
    window: "Board update.pptx", field: "revenue_growth", from: "12%", to: "15%", rect: { x: 0.4, y: 0.5, w: 0.1, h: 0.05 },
    frame_ref: "frames/0025.jpg",
  },
];

export function slideFlowSession(): Session {
  return {
    id: "s_slides",
    kind: "capture",
    started_at: "2026-10-03T10:00:00.000Z",
    expert: "Ben Keller",
    events: slideEvents.map((e) => ({ ...e })),
    transcript: [
      { id: "t1", t: 17, speaker: "expert", text: "That slide repeats slide three, the board hates repeats.", phase: "capture", redacted: true },
    ],
    qa: [
      {
        id: "q1", t_question: 27, t_answer: 29, question: "Why 15%?",
        answer: "The final numbers came in this morning.", event_id: "p3", phase: "capture", about: "reason",
      },
    ],
    off_record_ranges: [],
  };
}

export function navigationOnlySession(): Session {
  return {
    id: "s_nav",
    kind: "capture",
    started_at: "2026-10-03T11:00:00.000Z",
    events: [
      { id: "n0", t: 1, source: "os", type: "app_switched", entity: { kind: "app", id: OUTLOOK }, app: OUTLOOK },
      { id: "n1", t: 4, source: "vision", type: "navigated", entity: { kind: "folder", id: "Archive" }, app: OUTLOOK },
      { id: "n2", t: 9, source: "vision", type: "record_opened", entity: mail, app: OUTLOOK },
    ],
    transcript: [],
    qa: [],
    off_record_ranges: [],
  };
}
