// Error-tracking beforeSend scrubber (roadmap P0-5). Builds a new event from an allowlist; everything else is dropped.
// Pure and SDK-free: callers cast to their SDK's event type at the call site.
import { redactText } from "@/lib/redact";

const MESSAGE_MAX = 2000;
const TYPE_MAX = 200;
const TAG_MAX = 200;
const MAX_EXCEPTIONS = 10;
const MAX_FRAMES = 100;
const SCALAR_KEYS = ["event_id", "timestamp", "level", "platform", "environment", "release"] as const;
const TAG_KEYS = ["route", "runtime"] as const;

export type ScrubFrame = {
  filename?: string;
  function?: string;
  lineno?: number;
  colno?: number;
  in_app?: boolean;
};
export type ScrubException = {
  type?: string;
  value?: string;
  mechanism?: { type?: string; handled?: boolean };
  stacktrace?: { frames: ScrubFrame[] };
};
export type ScrubEvent = {
  event_id?: string | number;
  timestamp?: string | number;
  level?: string | number;
  platform?: string | number;
  environment?: string | number;
  release?: string | number;
  message?: string;
  exception?: { values: ScrubException[] };
  tags?: { route?: string; runtime?: string };
  request?: { method?: string };
};

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number";
// Order is fixed: redact first, then cut, so a cut can never split a value the recognizers would have matched.
const clean = (text: string, max: number) => redactText(text).text.slice(0, max);

function scrubFrame(f: unknown): ScrubFrame | null {
  if (!isObj(f)) return null;
  const out: ScrubFrame = {};
  // Build-time strings from our own code: passed through unredacted.
  if (isStr(f.filename)) out.filename = f.filename;
  if (isStr(f.function)) out.function = f.function;
  if (isNum(f.lineno)) out.lineno = f.lineno;
  if (isNum(f.colno)) out.colno = f.colno;
  if (typeof f.in_app === "boolean") out.in_app = f.in_app;
  return out;
}

function scrubException(e: unknown): ScrubException | null {
  if (!isObj(e)) return null;
  const out: ScrubException = {};
  if (isStr(e.type)) out.type = e.type.slice(0, TYPE_MAX);
  if (isStr(e.value)) out.value = clean(e.value, MESSAGE_MAX);
  if (isObj(e.mechanism)) {
    const m: ScrubException["mechanism"] = {};
    if (isStr(e.mechanism.type)) m.type = e.mechanism.type;
    if (typeof e.mechanism.handled === "boolean") m.handled = e.mechanism.handled;
    out.mechanism = m;
  }
  if (isObj(e.stacktrace) && Array.isArray(e.stacktrace.frames)) {
    const frames = e.stacktrace.frames.slice(-MAX_FRAMES).map(scrubFrame).filter((f): f is ScrubFrame => f !== null);
    out.stacktrace = { frames };
  }
  return out;
}

function scrub(event: unknown): ScrubEvent {
  const src = isObj(event) ? event : {};
  const out: ScrubEvent = {};
  for (const key of SCALAR_KEYS) {
    const v = src[key];
    if (isStr(v) || isNum(v)) out[key] = v;
  }
  if (isStr(src.message)) out.message = clean(src.message, MESSAGE_MAX);
  if (isObj(src.exception) && Array.isArray(src.exception.values)) {
    const values = src.exception.values
      .slice(0, MAX_EXCEPTIONS)
      .map(scrubException)
      .filter((e): e is ScrubException => e !== null);
    out.exception = { values };
  }
  if (isObj(src.tags)) {
    const tags: NonNullable<ScrubEvent["tags"]> = {};
    for (const key of TAG_KEYS) {
      const v = src.tags[key];
      if (isStr(v)) tags[key] = clean(v, TAG_MAX);
    }
    out.tags = tags;
  }
  // request.url, headers, cookies, data and query_string are dropped: only the method survives.
  if (isObj(src.request)) {
    out.request = isStr(src.request.method) ? { method: src.request.method } : {};
  }
  return out;
}

/** Returns a beforeSend hook. On any internal error it calls onFailure() with no arguments and drops the event. */
export function makeBeforeSend(onFailure: () => void): (event: unknown) => ScrubEvent | null {
  return (event) => {
    try {
      return scrub(event);
    } catch {
      onFailure();
      return null;
    }
  };
}
