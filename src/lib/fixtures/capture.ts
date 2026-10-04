// Capture console fixture (design compare, docs/design/compare/capture-*.png): Pip learning from Sabine, mid-session.
import type { ScreenEvent } from "@/lib/types";

const EXCEL = "Microsoft Excel";
const OUTLOOK = "Microsoft Outlook";
const invoice = { kind: "cell", id: "invoice 4517 cost center" };

/** Newest first, as the controller's feed() returns it. */
export const captureFeed: ScreenEvent[] = [
  { id: "c6", t: 422, source: "vision", type: "record_opened", entity: { kind: "supplier", id: "20418" }, app: "Google Chrome" },
  { id: "c5", t: 390, source: "os", type: "shortcut_used", entity: { kind: "app", id: OUTLOOK }, app: OUTLOOK, chord: "Cmd+J" },
  { id: "c4", t: 312, source: "vision", type: "field_changed", entity: invoice, app: EXCEL, field: "cost center", from: "4711", to: "0400" },
  { id: "c3", t: 298, source: "os", type: "shortcut_used", entity: { kind: "app", id: EXCEL }, app: EXCEL, chord: "Cmd+D" },
  { id: "c2", t: 185, source: "os", type: "shortcut_used", entity: { kind: "app", id: EXCEL }, app: EXCEL, chord: "Cmd+Shift+L" },
  { id: "c1", t: 161, source: "os", type: "app_switched", entity: { kind: "app", id: OUTLOOK }, app: OUTLOOK },
];

export const captureFixture = {
  agentName: "Pip",
  expert: "Sabine Keller",
  task: "Code incoming supplier invoices",
  elapsed: 768,
  lastQuestion: "You moved that one to capex. What made you do that?",
  askedAt: "Asked at a pause, after Enter in Excel · 14:05:14",
  lastAnswer: { expert: "Sabine", text: "Equipment over €5,000 is always capex. The servo drive is a machine part we keep for years.", seconds: 6 },
  answerChips: [
    { kind: "limit" as const, label: "Saved as guardrail · Limit" },
    { kind: "judgment" as const, label: "Judgment call · step 4" },
  ],
  asked: 3,
  guardrailAsked: 1,
  guardrails: 2,
  nextQuestionIn: 80,
  feed: captureFeed,
  permissions: { input: true, screen: true, accessibility: false },
};
