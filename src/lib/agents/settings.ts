// Agent settings: the one schema (keys, types, ranges, defaults) shared by the API, the UI, the behaviour wiring
// and the CHECK in supabase/migrations/20261004010000_agent_settings.sql (keep the three in step).
// Stored in agents.settings (jsonb, partial: a missing key means its default). Read once at session start.
import { z } from "zod";

/** Minimum gap between two questions, in seconds. 20 is the ask gate's historical minGapMs (20 000 ms). */
export const QUESTION_INTERVALS_S = [20, 60, 120, 180, 300] as const;
export const VOICE_PRESETS = ["calm", "neutral", "energetic"] as const;
export const VOICE_SPEED_MIN = 0.8;
export const VOICE_SPEED_MAX = 1.2;
export const RETENTION_DAYS = [7, 30, 90, 365] as const;
export const OFF_RECORD_DEFAULT = "off the record";
export const OFF_RECORD_MAX = 40;
/** Letters, digits, spaces, apostrophes and hyphens. Anything else (regex syntax included) is rejected. */
export const OFF_RECORD_RE = /^[\p{L}\p{N}' -]+$/u;

export type QuestionInterval = (typeof QUESTION_INTERVALS_S)[number];
export type VoicePreset = (typeof VOICE_PRESETS)[number];

const literalUnion = <T extends readonly number[]>(values: T) =>
  z.number().refine((n): n is T[number] => (values as readonly number[]).includes(n), { message: `one of ${values.join(", ")}` });

export const OffRecordPhrase = z
  .string()
  .trim()
  .min(1)
  .max(OFF_RECORD_MAX)
  .regex(OFF_RECORD_RE, "letters, digits, spaces, ' and - only");

/** Every key optional: a PATCH body is a merge patch, and stored rows may be partial. Unknown keys are rejected. */
export const AgentSettingsPatch = z.strictObject({
  question_interval_s: literalUnion(QUESTION_INTERVALS_S).optional(),
  guardrails_first: z.boolean().optional(),
  learn_shortcuts: z.boolean().optional(),
  voice_preset: z.enum(VOICE_PRESETS).optional(),
  voice_speed: z.number().min(VOICE_SPEED_MIN).max(VOICE_SPEED_MAX).multipleOf(0.1).optional(),
  redact_names_emails: z.boolean().optional(),
  redact_iban_phone: z.boolean().optional(),
  off_record_phrase: OffRecordPhrase.optional(),
  retention_days: literalUnion(RETENTION_DAYS).optional(),
});
export type AgentSettingsPatch = z.infer<typeof AgentSettingsPatch>;
export type AgentSettings = Required<AgentSettingsPatch>;
export const SETTINGS_KEYS = Object.keys(AgentSettingsPatch.shape) as (keyof AgentSettings)[];

export const DEFAULT_SETTINGS: AgentSettings = {
  question_interval_s: 20,
  guardrails_first: true,
  learn_shortcuts: true,
  voice_preset: "calm",
  voice_speed: 1,
  redact_names_emails: true,
  redact_iban_phone: true,
  off_record_phrase: OFF_RECORD_DEFAULT,
  retention_days: 90,
};

/** Stored jsonb to full settings: each valid key is kept, each missing or invalid key falls back to its default. */
export function resolveSettings(stored: unknown): AgentSettings {
  const out: AgentSettings = { ...DEFAULT_SETTINGS };
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return out;
  for (const key of SETTINGS_KEYS) {
    const parsed = AgentSettingsPatch.shape[key].safeParse((stored as Record<string, unknown>)[key]);
    if (parsed.success && parsed.data !== undefined) (out as Record<string, unknown>)[key] = parsed.data;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Behaviour wiring. Pure helpers; each caller reads the settings once when the session starts.
// ---------------------------------------------------------------------------

/** Ask gate minimum gap between two questions. */
export const minGapMs = (s: AgentSettings) => s.question_interval_s * 1000;

/** The empty or invalid phrase falls back to the default; the phrase is escaped before it goes into a RegExp. */
export function offRecordPhrase(s: Pick<AgentSettings, "off_record_phrase"> | null | undefined): string {
  const parsed = OffRecordPhrase.safeParse(s?.off_record_phrase);
  return parsed.success ? parsed.data.toLowerCase() : OFF_RECORD_DEFAULT;
}

const escapeRe = (v: string) => v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Whole-phrase, case-insensitive, any run of spaces between words. */
export function offRecordRegExp(phrase: string): RegExp {
  const words = offRecordPhrase({ off_record_phrase: phrase }).split(/\s+/).map(escapeRe);
  return new RegExp(String.raw`(?<![\p{L}\p{N}])${words.join(String.raw`\s+`)}(?![\p{L}\p{N}])`, "iu");
}

/** Which recognizer groups run before storage. Card numbers always run. */
export type RecognizerSelection = { namesEmails: boolean; ibanPhone: boolean };
export const recognizers = (s: AgentSettings): RecognizerSelection => ({
  namesEmails: s.redact_names_emails,
  ibanPhone: s.redact_iban_phone,
});

/** ElevenLabs TTS fields a session may override (platform_settings.overrides.conversation_config_override.tts). */
export const VOICE_OVERRIDE_FIELDS = ["speed", "stability"] as const;
const PRESET_STABILITY: Record<VoicePreset, number> = { calm: 0.75, neutral: 0.5, energetic: 0.3 };
export const VOICE_PRESET_FALLBACK =
  "Voice style needs the voice agent to allow TTS overrides. Only the speed is applied until it does.";

export type VoiceOverrides = { tts: { speed: number; stability?: number } };

/**
 * Session overrides for the voice layer. The preset maps to TTS stability, which needs the agent's tts override
 * permission; without it only the speed is sent (the SDK applies speed client-side) and `notice` says so.
 */
export function voiceOverrides(s: AgentSettings, ttsOverrideAllowed: boolean): { overrides: VoiceOverrides; notice: string | null } {
  if (!ttsOverrideAllowed) return { overrides: { tts: { speed: s.voice_speed } }, notice: VOICE_PRESET_FALLBACK };
  return { overrides: { tts: { speed: s.voice_speed, stability: PRESET_STABILITY[s.voice_preset] } }, notice: null };
}

/** UI labels, quoted from docs/design/canvas/Agent.dc.html (settings tab). */
export const intervalLabel = (s: number) => (s < 60 ? `${s} s` : `${s / 60} min`);
export const presetLabel = (p: VoicePreset) => p[0].toUpperCase() + p.slice(1);
export const speedLabel = (n: number) => `${n.toFixed(1)}×`;
export const retentionLabel = (d: number) => `${d} days`;
