// Structured JSON server logs (docs/OBSERVABILITY.md): one line per call, string values redacted,
// one "request" line per API request via withRequestLog or withApi.
import { AsyncLocalStorage } from "node:async_hooks";
import { createHash, randomUUID } from "node:crypto";
import { captureHandled500 } from "@/lib/observability/capture";
import { redactText } from "@/lib/redact";

export type Level = "info" | "warn" | "error";
export type Fields = Record<string, unknown>;

const RESERVED = new Set(["ts", "level", "event", "requestId"]);
const REQUEST_ID = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_DEPTH = 6;

const requestScope = new AsyncLocalStorage<{ requestId: string; setWorkspace: (id: string) => void }>();

/** The x-request-id header when it is a safe token, otherwise a random UUID. */
export function requestIdFrom(req?: Request | null): string {
  let header: string | null | undefined;
  try {
    header = req?.headers?.get?.("x-request-id");
  } catch {
    header = null;
  }
  return header && REQUEST_ID.test(header) ? header : randomUUID();
}

/**
 * Workspace id as a truncated salted sha256. Salt: FORWARDED_USER_SECRET, else SUPABASE_SERVICE_ROLE_KEY.
 * Without either (local mode) the fixed marker "local", never an unsalted hash.
 */
export function workspaceHash(workspaceId: string): string {
  const salt = process.env.FORWARDED_USER_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!salt) return "local";
  return createHash("sha256").update(`${salt}:${workspaceId}`).digest("hex").slice(0, 16);
}

const redact = (s: string) => {
  try {
    return redactText(s).text;
  } catch {
    return "[unredactable]";
  }
};

/** JSON-safe copy: strings redacted, Errors as {name, message, stack}, cycles and deep values cut. */
function clean(value: unknown, seen: WeakSet<object>, depth: number): unknown {
  if (typeof value === "string") return redact(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object") return undefined;
  if (seen.has(value)) return "[Circular]";
  if (depth >= MAX_DEPTH) return "[Truncated]";
  seen.add(value);
  try {
    if (value instanceof Error) {
      return {
        name: redact(String(value.name)),
        message: redact(String(value.message)),
        ...(value.stack ? { stack: redact(String(value.stack)) } : {}),
      };
    }
    if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
    if (Array.isArray(value)) return value.map((v) => clean(v, seen, depth + 1) ?? null);
    const out: Fields = {};
    for (const [k, v] of Object.entries(value)) {
      const c = clean(v, seen, depth + 1);
      if (c !== undefined) out[k] = c;
    }
    return out;
  } catch {
    return "[Unserializable]";
  } finally {
    seen.delete(value);
  }
}

/** Writes one line. trusted fields (ids the logger built itself) skip redaction; callers' fields never do. */
function emit(level: Level, event: string, fields: Fields = {}, trusted: Fields = {}): void {
  const line: Fields = { ts: new Date().toISOString(), level, event: redact(String(event)) };
  const seen = new WeakSet<object>();
  let entries: [string, unknown][] = [];
  try {
    entries = Object.entries(fields ?? {});
  } catch {
    entries = [];
  }
  for (const [k, v] of entries) {
    if (RESERVED.has(k)) continue;
    const c = clean(v, seen, 1);
    if (c !== undefined) line[k] = c;
  }
  for (const [k, v] of Object.entries(trusted)) if (v !== undefined) line[k] = v;
  const requestId = (trusted.requestId as string | undefined) ?? requestScope.getStore()?.requestId;
  if (requestId) line.requestId = requestId;
  const text = JSON.stringify(line);
  if (level === "error") console.error(text);
  else if (level === "warn") console.warn(text);
  else console.log(text);
}

export const log = {
  info: (event: string, fields?: Fields) => emit("info", event, fields),
  warn: (event: string, fields?: Fields) => emit("warn", event, fields),
  error: (event: string, fields?: Fields) => emit("error", event, fields),
};

/** Route and request of a handler, for the request line. */
export type RequestLogScope = { route: string; req?: Request | null };

export type RequestLine = { status: number; thrown?: boolean; workspaceId?: string };

/**
 * Runs fn inside a request scope (log.* lines carry its requestId) and writes one request line:
 * {event: "request", route, method, status, ms, requestId}. A throw logs status 500 and thrown: true, then rethrows.
 * fn reports the workspace id through setWorkspace once it is known. Nested inside another request scope
 * (withApi under withRequestLog) only the outer call writes the line. A returned status 500 is then sent to Sentry
 * once (captureHandled500, off without SENTRY_DSN); a throw never is.
 */
export async function logRequest(
  scope: RequestLogScope,
  fn: (setWorkspace: (id: string) => void) => Promise<Response> | Response,
): Promise<Response> {
  const outer = requestScope.getStore();
  if (outer) return fn(outer.setWorkspace);
  const t0 = performance.now();
  const requestId = requestIdFrom(scope.req);
  let method = "-";
  try {
    method = typeof scope.req?.method === "string" ? scope.req.method : "-";
  } catch {}
  let workspaceId: string | undefined;
  const line = (status: number, thrown: boolean) =>
    emit(
      thrown || status >= 500 ? "error" : "info",
      "request",
      { route: scope.route, method, status, ms: Math.round(performance.now() - t0), ...(thrown ? { thrown: true } : {}) },
      { requestId, ...(workspaceId !== undefined ? { workspace: workspaceHash(workspaceId) } : {}) },
    );
  const setWorkspace = (id: string) => {
    workspaceId = id;
  };
  return requestScope.run({ requestId, setWorkspace }, async () => {
    let res: Response;
    try {
      res = await fn(setWorkspace);
    } catch (err) {
      line(500, true);
      throw err;
    }
    const status = typeof res?.status === "number" ? res.status : 500;
    line(status, false);
    // Handled 500s only; thrown errors reach Sentry through onRequestError. Never rejects.
    if (status === 500) await captureHandled500({ route: scope.route, requestId });
    return res;
  });
}

/** Wraps a route handler so every call writes one request line (see logRequest). Never swallows a throw. */
export function withRequestLog<A extends unknown[]>(
  route: string,
  handler: (req: Request, ...rest: A) => Promise<Response> | Response,
): (req?: Request, ...rest: A) => Promise<Response> {
  // req is optional only for direct calls in tests; Next.js always passes it.
  return (req?: Request, ...rest: A) => logRequest({ route, req }, () => handler(req as Request, ...rest));
}
