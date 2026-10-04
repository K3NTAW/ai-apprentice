// Teach page failure texts. Raw errors (URLs, status codes, exception messages) never reach the page:
// they go to the console and the learner sees a short, calm sentence instead.

/** A failed fetch with its HTTP status, so callers can pick a text without parsing the message. */
export class HttpError extends Error {
  constructor(
    readonly url: string,
    readonly status: number,
  ) {
    super(`${url} ${status}`);
    this.name = "HttpError";
  }
}

export const statusOf = (err: unknown): number | null => (err instanceof HttpError ? err.status : null);

/** Logs the raw error for developers; the page only shows the returned text. */
export function quiet(text: string, err?: unknown): string {
  if (err !== undefined) console.warn(`teach: ${text}`, err);
  return text;
}

export type SaveOutcome = { kind: "saved" } | { kind: "sample" } | { kind: "failed"; err: unknown };

/** The line under the mastery summary plus an optional quiet notice. Never the words "Not saved", never a status code. */
export function saveOutcomeText(o: SaveOutcome): { saved: string; notice: string | null } {
  if (o.kind === "saved") return { saved: "Saved to this teach session.", notice: null };
  if (o.kind === "sample") return { saved: "Practice run on the sample Work Map: progress stays on this page.", notice: null };
  // 503: migration 20261004040000_session_teach not applied yet; nothing the learner can do, so say little.
  if (statusOf(o.err) === 503) return { saved: "", notice: quiet("Progress tracking is not switched on yet for this workspace.", o.err) };
  return { saved: "", notice: quiet("Your progress could not be stored this time. The results below are still yours.", o.err) };
}

export const visionFailedText = (err: unknown) =>
  statusOf(err) === 429
    ? "Daily vision limit reached: the tutor cannot see the screen any more today."
    : quiet("The tutor cannot see the screen right now. It keeps trying.", err);
