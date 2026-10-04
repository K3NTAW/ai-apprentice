// Redacts the free-text fields of a screen event (app, window, from, to) before storage or any LLM call.
import { redactText } from "@/lib/redact";
import type { ScreenEvent } from "@/lib/types";

const TEXT_FIELDS = ["app", "window", "from", "to"] as const;

export function redactScreenEvent<E extends Partial<Pick<ScreenEvent, (typeof TEXT_FIELDS)[number]>>>(event: E): E {
  const out = { ...event };
  for (const k of TEXT_FIELDS) {
    const v = out[k];
    if (typeof v === "string") out[k] = redactText(v).text as E[typeof k];
  }
  return out;
}
