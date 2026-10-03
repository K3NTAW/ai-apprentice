// Shared data contracts (docs/BUILD_SPEC.md section 8).
// Schemas and tiny pure helpers only: no I/O, no React. Safe for client and server.
import { z } from "zod";

const Unit = z.number().min(0).max(1);

// Tolerance for float rounding when checking that a rect stays inside the frame.
const RECT_EPS = 1e-6;

/** Rect normalised 0..1 of the captured frame (the primary display). Never clamped: out of range is invalid. */
export const RectSchema = z
  .object({ x: Unit, y: Unit, w: Unit, h: Unit })
  .refine((r) => r.x + r.w <= 1 + RECT_EPS && r.y + r.h <= 1 + RECT_EPS, { message: "rect outside the frame" });
export type Rect = z.infer<typeof RectSchema>;

export const SCREEN_EVENT_TYPES = [
  "record_opened",
  "field_changed",
  "button_clicked",
  "status_changed",
  "app_switched",
  "text_entered",
  "item_created",
  "item_sent",
  "item_deleted",
  "navigated",
] as const;
export type ScreenEventType = (typeof SCREEN_EVENT_TYPES)[number];

export const ScreenEventSchema = z.object({
  id: z.string(),
  t: z.number(),
  // os: frontmost app or window changes reported by the desktop companion.
  source: z.enum(["vision", "dom", "os"]),
  type: z.enum(SCREEN_EVENT_TYPES),
  // kind is free text, e.g. "email", "slide", "cell", "file".
  entity: z.object({ kind: z.string(), id: z.string() }),
  app: z.string().optional(),
  window: z.string().optional(),
  rect: RectSchema.optional(),
  field: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  frame_ref: z.string().optional(),
});
export type ScreenEvent = z.infer<typeof ScreenEventSchema>;

export const VisionEventSchema = ScreenEventSchema.omit({
  id: true,
  t: true,
  source: true,
  frame_ref: true,
});
export type VisionEvent = z.infer<typeof VisionEventSchema>;

export const VisionResultSchema = z.object({ events: z.array(VisionEventSchema) });
export type VisionResult = z.infer<typeof VisionResultSchema>;

export const TranscriptEntrySchema = z.object({
  id: z.string(),
  t: z.number(),
  speaker: z.enum(["expert", "agent", "learner"]),
  text: z.string(),
  phase: z.enum(["capture", "debrief", "teach"]),
  redacted: z.boolean(),
});
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

export const QAPairSchema = z.object({
  id: z.string(),
  t_question: z.number(),
  t_answer: z.number().optional(),
  question: z.string(),
  answer: z.string().optional(),
  event_id: z.string().optional(),
  frame_ref: z.string().optional(),
  phase: z.enum(["capture", "debrief"]),
  about: z.enum(["reason", "guardrail", "other"]),
});
export type QAPair = z.infer<typeof QAPairSchema>;

export const DECISION_QUESTION_NAMES = [
  "event_class",
  "screen_explains_it",
  "ask_timing",
  "step_reason_captured",
  "step_guardrail_captured",
  "violates_guardrail",
] as const;
export const DecisionQuestionNameSchema = z.enum(DECISION_QUESTION_NAMES);
export type DecisionQuestionName = z.infer<typeof DecisionQuestionNameSchema>;

export type DecisionQuestionSpec = {
  kind: "choice" | "probability" | "score";
  options?: readonly string[];
  prompt: string;
};

export const DECISION_QUESTIONS = {
  event_class: {
    kind: "choice",
    options: ["routine", "judgment_call", "possible_guardrail"] as const,
    prompt: "Is this screen event routine, a judgment call, or a possible guardrail?",
  },
  screen_explains_it: {
    kind: "probability",
    prompt: "Does what is on screen already explain why the expert did this?",
  },
  ask_timing: {
    kind: "choice",
    options: ["ask_now", "wait", "save_for_debrief"] as const,
    prompt: "Should the agent ask about this now, wait, or save it for the debrief?",
  },
  step_reason_captured: {
    kind: "score",
    prompt: "How fully has the reason for this step been captured?",
  },
  step_guardrail_captured: {
    kind: "score",
    prompt: "How fully have the guardrails for this step been captured?",
  },
  violates_guardrail: {
    kind: "probability",
    prompt: "Does the pending decision violate any of the captured guardrails?",
  },
} as const satisfies Record<DecisionQuestionName, DecisionQuestionSpec>;

export const DecisionResultSchema = z.object({
  question: DecisionQuestionNameSchema,
  answer: z.union([z.string(), Unit]),
  confidence: Unit,
  provider: z.enum(["jev", "llm", "heuristic"]),
  latency_ms: z.number().min(0),
});
export type DecisionResult = z.infer<typeof DecisionResultSchema>;

export const GuardrailSchema = z.object({
  rule: z.string(),
  quote_ref: z.number(),
  kind: z.enum(["limit", "exception", "stop_and_ask"]),
  quote: z.string().optional(),
});
export type Guardrail = z.infer<typeof GuardrailSchema>;

export const WorkMapStepSchema = z.object({
  n: z.number(),
  title: z.string(),
  screen_moment: z.object({
    t: z.number(),
    frame_ref: z.string().optional(),
    app: z.string().optional(),
    entity: z.string(),
    field: z.string().optional(),
  }),
  decision: z.string(),
  is_judgment_call: z.boolean(),
  reason: z
    .object({
      quote: z.string(),
      t: z.number(),
      source: z.enum(["live_question", "debrief", "narration"]),
    })
    .nullable(),
  guardrails: z.array(GuardrailSchema),
  scores: z.object({ reason_captured: Unit, guardrail_captured: Unit }),
});
export type WorkMapStep = z.infer<typeof WorkMapStepSchema>;

export const WorkMapSchema = z.object({
  task: z.string(),
  expert: z.string(),
  confirmed_by_expert: z.boolean(),
  steps: z.array(WorkMapStepSchema),
  open_questions: z.array(z.string()),
});
export type WorkMap = z.infer<typeof WorkMapSchema>;

export const TEACH_LIST_MAX = 200;

/**
 * Teach progress, written by the Teach task and read by the control room.
 * Write semantics: the writer replaces the whole object; mastered and practice are step ids
 * (writers union mastered with the stored list before writing); interventions is a monotonic
 * counter written only by the tutor.
 */
export const TeachProgressSchema = z.object({
  workmap_session_id: z.string(),
  mastered: z.array(z.string()).max(TEACH_LIST_MAX),
  practice: z.array(z.string()).max(TEACH_LIST_MAX),
  interventions: z.number().int().min(0),
  finished_at: z.string().optional(),
});
export type TeachProgress = z.infer<typeof TeachProgressSchema>;

export const SessionSchema = z.object({
  id: z.string(),
  kind: z.enum(["capture", "teach"]),
  started_at: z.string(),
  ended_at: z.string().optional(),
  expert: z.string().optional(),
  events: z.array(ScreenEventSchema),
  transcript: z.array(TranscriptEntrySchema),
  qa: z.array(QAPairSchema),
  workmap: WorkMapSchema.optional(),
  off_record_ranges: z.array(z.object({ from: z.number(), to: z.number().optional() })),
  // Stored frame files with their capture time, so off-record purges can find them. Optional for older sessions.
  frames: z.array(z.object({ name: z.string(), t: z.number() })).optional(),
  teach: TeachProgressSchema.optional(),
  // The agent this session trains or teaches. Set at creation only; null in the DB after the agent is deleted.
  agent_id: z.string().optional(),
});
export type Session = z.infer<typeof SessionSchema>;

// AVATAR CONTRACT, shared by the web app, src/lib/avatar/render.ts and the API. Single source: AvatarSchema.
export const AVATAR_SHAPES = ["blob", "round", "square", "pill", "bean", "star"] as const;
export const AVATAR_FACES = ["smile", "focus", "curious", "calm", "wink", "robot"] as const;
export const AVATAR_STATES = ["idle", "listening", "thinking", "talking", "asking", "stop", "happy", "paused"] as const;
export type AvatarState = (typeof AVATAR_STATES)[number];

const HexColor = z.string().regex(/^#[0-9A-Fa-f]{6}$/, "colour must be #RRGGBB");

/** Strict: unknown keys are rejected. */
export const AvatarSchema = z.strictObject({
  shape: z.enum(AVATAR_SHAPES),
  face: z.enum(AVATAR_FACES),
  color: HexColor,
  accent: HexColor,
});
export type Avatar = z.infer<typeof AvatarSchema>;

export const AGENT_NAME_MAX = 60;
export const AGENT_ROLE_MAX = 80;
export const AGENT_EXPERT_NAME_MAX = 80;

export const AgentSchema = z.object({
  id: z.string(),
  workspace_id: z.string(),
  name: z.string().min(1).max(AGENT_NAME_MAX),
  role: z.string().min(1).max(AGENT_ROLE_MAX),
  expert_name: z.string().max(AGENT_EXPERT_NAME_MAX).optional(),
  avatar: AvatarSchema,
  created_at: z.string(),
  updated_at: z.string(),
});
export type Agent = z.infer<typeof AgentSchema>;

export const InvoiceSchema = z.object({
  id: z.string(),
  supplier: z.string(),
  supplier_country: z.string(),
  supplier_entity: z.string(),
  date: z.string(),
  amount_eur: z.number(),
  description: z.string(),
  cost_center: z.string(),
  asset_number: z.string(),
  approval_status: z.enum(["open", "saved", "on_hold", "second_approval"]),
  contact_name: z.string().optional(),
  iban: z.string().optional(),
  teach_only: z.boolean().optional(),
});
export type Invoice = z.infer<typeof InvoiceSchema>;

/** Debrief ends when every step's two scores are at or above this. */
export const SCORE_THRESHOLD = 0.75;

export function newId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
