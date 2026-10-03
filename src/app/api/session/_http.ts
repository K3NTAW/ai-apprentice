// Shared helpers for the /api/session route handlers.
import type { z } from "zod";
import { InvalidOffRecordRangeError, InvalidSessionIdError, SessionNotFoundError } from "@/lib/store";

export const badRequest = (error: string, details?: unknown) =>
  Response.json({ error, ...(details !== undefined ? { details } : {}) }, { status: 400 });

export const notFound = (error = "not found") => Response.json({ error }, { status: 404 });

export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; res: Response }> {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return { ok: false, res: badRequest("invalid json") };
  }
  const parsed = schema.safeParse(json);
  if (!parsed.success) return { ok: false, res: badRequest("invalid body", parsed.error.issues) };
  return { ok: true, data: parsed.data };
}

/** Maps store errors to HTTP responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof InvalidSessionIdError) return badRequest(err.message);
    if (err instanceof InvalidOffRecordRangeError) return badRequest(err.message);
    if (err instanceof SessionNotFoundError) return notFound(err.message);
    throw err;
  }
}

export type IdContext = { params: Promise<{ id: string }> };
