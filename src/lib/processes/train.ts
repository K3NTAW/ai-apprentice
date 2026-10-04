// Slice (d): the two training entry points of a process. 'Add to this process' opens Capture with mode=extend and
// 'Retrain from scratch' with mode=replace; Capture passes the intent to the debrief, which then saves the confirmed
// Work Map into that process (add or replace) without asking.
export const TRAIN_MODES = ["extend", "replace"] as const;
export type TrainMode = (typeof TRAIN_MODES)[number];
export type TrainIntent = { processId: string; mode: TrainMode };

const ID = /^[0-9a-zA-Z-]{1,64}$/;

export const trainHref = (agentId: string, processId: string, mode: TrainMode) =>
  `/capture?agent=${encodeURIComponent(agentId)}&process=${encodeURIComponent(processId)}&mode=${mode}`;

/** ?process and ?mode, both valid, else null. */
export function parseTrainIntent(process: unknown, mode: unknown): TrainIntent | null {
  if (typeof process !== "string" || !ID.test(process)) return null;
  if (typeof mode !== "string" || !(TRAIN_MODES as readonly string[]).includes(mode)) return null;
  return { processId: process, mode: mode as TrainMode };
}

/** The query Capture appends to the debrief link ('' without an intent). */
export const intentQuery = (intent: TrainIntent | null) =>
  intent ? `?process=${encodeURIComponent(intent.processId)}&mode=${intent.mode}` : "";

/** The debrief's save choice for an intent. */
export const intentChoice = (mode: TrainMode) => (mode === "extend" ? "add" : "replace");
