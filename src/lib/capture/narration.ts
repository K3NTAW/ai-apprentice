// Unprompted narration (T-0240): what the expert says while working, without being asked.
// One linking rule for the live loop (controller), Work Map synthesis and the debrief:
// - an utterance is an explanation when it reads like a reason or a rule (EXPLAIN_RE);
// - it links to the screen events from LINK_BEFORE_S before to LINK_AFTER_S after it, nearest first,
//   ties to the earlier event (the expert usually explains what they just did), at most MAX_LINKS events.
// Linking is by time only, so it still works on redacted text (stored quotes are redacted).
import type { QAPair, ScreenEvent, TranscriptEntry } from "@/lib/types";

export const LINK_BEFORE_S = 20;
export const LINK_AFTER_S = 5;
export const MAX_LINKS = 3;
/** An expert transcript entry this close to a capture-phase Q&A answer is that answer, not narration. */
export const ANSWER_MATCH_S = 1;

const EXPLAIN_RE =
  /\b(because|since|so that|always|never|only (if|when)|unless|otherwise|in case|make sure|have to|must|whenever|the rule|policy|limit|threshold)\b|\bcheck\b.*\bbefore\b/i;

export const isExplanation = (text: string): boolean => EXPLAIN_RE.test(text);

type Timed = Pick<ScreenEvent, "id" | "t">;

/** Ids of the events an utterance at t links to (nearest first, ties to the earlier event, at most MAX_LINKS). */
export function linkNarration(t: number, events: readonly Timed[]): string[] {
  return events
    .filter((e) => e.t >= t - LINK_BEFORE_S && e.t <= t + LINK_AFTER_S)
    .map((e, n) => ({ e, n, d: Math.abs(e.t - t) }))
    .sort((a, b) => a.d - b.d || a.e.t - b.e.t || a.n - b.n)
    .slice(0, MAX_LINKS)
    .map((x) => x.e.id);
}

export type Narration = { t: number; text: string; event_ids: string[] };

/** Capture-phase expert narration (answers to live questions excluded), each with its linked events. */
export function narrationsOf(session: { transcript: TranscriptEntry[]; events: ScreenEvent[]; qa: QAPair[] }): Narration[] {
  const answers = session.qa.filter((q) => q.phase === "capture" && q.answer !== undefined && q.t_answer !== undefined);
  const events = session.events.filter((e) => e.type !== "shortcut_used");
  return session.transcript
    .filter((e) => e.speaker === "expert" && e.phase === "capture")
    .filter((e) => !answers.some((q) => Math.abs((q.t_answer ?? 0) - e.t) <= ANSWER_MATCH_S))
    .map((e) => ({ t: e.t, text: e.text, event_ids: linkNarration(e.t, events) }));
}

/** Event id -> the explanation that covers it (first one wins). */
export function explainedEvents(narrations: readonly Narration[]): Map<string, Narration> {
  const out = new Map<string, Narration>();
  for (const n of narrations) {
    if (!isExplanation(n.text)) continue;
    for (const id of n.event_ids) if (!out.has(id)) out.set(id, n);
  }
  return out;
}
