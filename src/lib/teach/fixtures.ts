// Teach fixtures on real apps (no sandbox): an email flow (Outlook + Excel) and a slide flow (PowerPoint).
// Used by the stepMatch, intervention and mastery tests and as the sample Work Map in local mode.
import type { ScreenEvent, WorkMap } from "@/lib/types";

const Q = {
  supplier: "If I don't know the supplier, I stop and ask the controller.",
  capex: "Equipment over €5,000 is always capex, so it gets code 0400.",
  reply: "I always confirm the code back to the requester before I close the mail.",
  title: "The title slide always carries the customer's name, never ours.",
  price: "Never put a discount over 10% on a slide without sales sign-off.",
} as const;

const scores = { reason_captured: 0.9, guardrail_captured: 0.9 };

/** Email flow: an equipment purchase request arrives in Outlook and is coded in the purchases sheet. */
export const EMAIL_FLOW_WORKMAP: WorkMap = {
  task: "Code incoming purchase requests",
  expert: "Sabine",
  confirmed_by_expert: true,
  steps: [
    {
      n: 1,
      title: "Open the purchase request email",
      screen_moment: { t: 10, app: "Microsoft Outlook", entity: "email", field: "subject" },
      decision: "Open the request and check the supplier is known before coding anything.",
      is_judgment_call: false,
      reason: { quote: Q.supplier, t: 14, source: "live_question" },
      guardrails: [{ rule: "Unknown supplier: stop and ask the controller", quote_ref: 14, kind: "stop_and_ask", quote: Q.supplier }],
      scores,
    },
    {
      n: 2,
      title: "Enter the amount in the purchases sheet",
      screen_moment: { t: 30, app: "Microsoft Excel", entity: "cell", field: "amount" },
      decision: "Copy the amount from the email into the purchases sheet.",
      is_judgment_call: false,
      reason: { quote: "First the amount, so the sheet matches the mail.", t: 32, source: "narration" },
      guardrails: [],
      scores,
    },
    {
      n: 3,
      title: "Set the cost code",
      screen_moment: { t: 48, frame_ref: "frames/sabine-48.jpg", app: "Microsoft Excel", entity: "cell", field: "cost_code" },
      decision: "Equipment over 5,000 EUR gets capex code 0400 instead of 4711.",
      is_judgment_call: true,
      reason: { quote: Q.capex, t: 52, source: "live_question" },
      guardrails: [{ rule: "Equipment over 5,000 EUR must be coded 0400", quote_ref: 52, kind: "limit", quote: Q.capex }],
      scores,
    },
    {
      n: 4,
      title: "Reply to the requester",
      screen_moment: { t: 70, app: "Microsoft Outlook", entity: "email", field: "body" },
      decision: "Reply briefly and confirm the cost code.",
      is_judgment_call: false,
      reason: { quote: Q.reply, t: 74, source: "narration" },
      guardrails: [],
      scores,
    },
  ],
  open_questions: [],
};

/** Slide flow: a customer offer deck is prepared in PowerPoint. */
export const SLIDE_FLOW_WORKMAP: WorkMap = {
  task: "Prepare the customer offer deck",
  expert: "Marco",
  confirmed_by_expert: true,
  steps: [
    {
      n: 1,
      title: "Set the title slide",
      screen_moment: { t: 5, app: "Microsoft PowerPoint", entity: "slide", field: "title" },
      decision: "Put the customer's name on the title slide.",
      is_judgment_call: false,
      reason: { quote: Q.title, t: 8, source: "narration" },
      guardrails: [],
      scores,
    },
    {
      n: 2,
      title: "Fill in the price table",
      screen_moment: { t: 40, app: "Microsoft PowerPoint", entity: "slide", field: "discount" },
      decision: "Enter the list price and a discount of at most 10%.",
      is_judgment_call: true,
      reason: { quote: Q.price, t: 44, source: "live_question" },
      guardrails: [{ rule: "Discount over 10% needs sales sign-off", quote_ref: 44, kind: "limit", quote: Q.price }],
      scores,
    },
    {
      n: 3,
      title: "Attach the deck to the offer email",
      screen_moment: { t: 80, app: "Microsoft Outlook", entity: "email", field: "attachment" },
      decision: "Attach the deck to the offer email.",
      is_judgment_call: false,
      reason: null,
      guardrails: [],
      scores,
    },
  ],
  open_questions: [],
};

const ev = (e: Omit<ScreenEvent, "source">): ScreenEvent => ({ source: "vision", ...e });
const R = { x: 0.42, y: 0.31, w: 0.12, h: 0.04 };

/** The learner on the email flow: a EUR 7,200 equipment purchase, coded 4711 first (wrong), then 0400. */
export const EMAIL_FLOW_EVENTS: ScreenEvent[] = [
  ev({ id: "e1", t: 1, type: "record_opened", app: "Microsoft Outlook", window: "Inbox - Outlook", entity: { kind: "email", id: "Purchase request: servo press" }, field: "subject" }),
  ev({ id: "e2", t: 9, type: "field_changed", app: "Microsoft Excel", window: "purchases.xlsx", entity: { kind: "cell", id: "row 14" }, field: "amount", from: "", to: "EUR 7,200", rect: R }),
  ev({ id: "e3", t: 15, type: "field_changed", app: "Microsoft Excel", window: "purchases.xlsx", entity: { kind: "cell", id: "row 14" }, field: "cost_code", from: "", to: "4711", rect: R }),
  ev({ id: "e4", t: 22, type: "field_changed", app: "Microsoft Excel", window: "purchases.xlsx", entity: { kind: "cell", id: "row 14" }, field: "cost_code", from: "4711", to: "0400", rect: R }),
  ev({ id: "e5", t: 30, type: "text_entered", app: "Microsoft Outlook", window: "RE: Purchase request", entity: { kind: "email", id: "RE: Purchase request: servo press" }, field: "body", to: "Coded 0400." }),
];

/** The learner on the slide flow. */
export const SLIDE_FLOW_EVENTS: ScreenEvent[] = [
  ev({ id: "s1", t: 2, type: "text_entered", app: "Microsoft PowerPoint", window: "Offer.pptx", entity: { kind: "slide", id: "1" }, field: "title", to: "Offer for Muster AG" }),
  ev({ id: "s2", t: 12, type: "field_changed", app: "Microsoft PowerPoint", window: "Offer.pptx", entity: { kind: "slide", id: "4" }, field: "discount", from: "5%", to: "15%", rect: R }),
  ev({ id: "s3", t: 20, type: "item_created", app: "Microsoft Outlook", window: "Offer Muster AG", entity: { kind: "email", id: "Offer Muster AG" }, field: "attachment", to: "Offer.pptx" }),
];
