// Pure helpers for the Work Map viewer. No I/O, no React.
import type { WorkMap, WorkMapStep } from "@/lib/types";

export type WorkMapCounts = { steps: number; judgmentCalls: number; guardrails: number };

export function counts(workmap: WorkMap): WorkMapCounts {
  return {
    steps: workmap.steps.length,
    judgmentCalls: workmap.steps.filter((s) => s.is_judgment_call).length,
    guardrails: workmap.steps.reduce((n, s) => n + s.guardrails.length, 0),
  };
}

export function countsLine(workmap: WorkMap): string {
  const c = counts(workmap);
  return `${c.steps} steps · ${c.judgmentCalls} judgment calls · ${c.guardrails} guardrails`;
}

/** Seconds since session start -> "mm:ss" (minutes keep counting past 59). */
export function formatT(seconds: number): string {
  const total = Math.max(0, Math.floor(Number.isFinite(seconds) ? seconds : 0));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

type ReasonSource = NonNullable<WorkMapStep["reason"]>["source"];

const SOURCE_LABELS: Record<ReasonSource, string> = {
  live_question: "live question",
  debrief: "debrief",
  narration: "narration",
};

export function sourceLabel(source: ReasonSource): string {
  return SOURCE_LABELS[source] ?? String(source).replace(/_/g, " ");
}

const KIND_LABELS: Record<WorkMapStep["guardrails"][number]["kind"], string> = {
  limit: "limit",
  exception: "exception",
  stop_and_ask: "stop and ask",
};

export function guardrailKindLabel(kind: WorkMapStep["guardrails"][number]["kind"]): string {
  return KIND_LABELS[kind] ?? kind;
}

export function frameUrl(sessionId: string, frameRef: string): string {
  return `/api/session/${encodeURIComponent(sessionId)}/frames/${encodeURIComponent(frameRef)}`;
}

/** Started-at as "YYYY-MM-DD HH:mm" in Europe/Zurich, 24h. */
export function formatZurich(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Zurich",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}`;
}
