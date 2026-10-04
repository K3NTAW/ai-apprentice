// Notices for a 429 daily_limit from the paid API routes (vision, decide, workmap, voice/signed-url).
// Shared by Capture, Debrief and Teach. Caps reset at midnight Europe/Zurich.

const WHAT: Record<string, string> = {
  vision: "screen reading",
  decide: "question decisions",
  workmap: "Work Map building",
  voice: "voice sessions",
};

/** Capture side panel notice for the kinds refused today, or null when none. */
export function dailyLimitNotice(kinds: readonly string[]): string | null {
  if (!kinds.length) return null;
  const list = kinds.map((k) => WHAT[k] ?? k).join(" and ");
  const rest = kinds.includes("decide")
    ? "New steps are saved for the debrief instead of asked now."
    : "Capture keeps recording the events it sees on screen.";
  return `Daily limit reached for ${list} in this workspace (resets at midnight). ${rest}`;
}

/** True for the error message useVoiceAgent throws when signed-url answers 429 daily_limit. */
export const isVoiceDailyLimit = (message: string) => message === "daily_limit";

/** Voice start failure text; the daily limit gets its own wording. */
export function voiceStartNotice(message: string, textModeHint: string): string {
  return isVoiceDailyLimit(message)
    ? `Daily voice limit reached for this workspace (resets at midnight). ${textModeHint}`
    : `Voice could not start (${message}). ${textModeHint}`;
}
