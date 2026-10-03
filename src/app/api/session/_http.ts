// Shared helpers for the /api/session route handlers.
import type { z } from "zod";
import { type RequestContext, requireContext } from "@/lib/auth/context";
import {
  getStore,
  InvalidOffRecordRangeError,
  InvalidSessionIdError,
  isValidSessionId,
  SessionNotFoundError,
  type SessionStore,
} from "@/lib/store";

export const badRequest = (error: string, details?: unknown) =>
  Response.json({ error, ...(details !== undefined ? { details } : {}) }, { status: 400 });

export const notFound = (error = "not found") => Response.json({ error }, { status: 404 });

export const forbidden = () => Response.json({ error: "forbidden" }, { status: 403 });

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
    // getStore errors: never fall back to the file store.
    if (err instanceof Error && err.message === "supabase_not_configured") {
      return Response.json({ error: "supabase_not_configured" }, { status: 503 });
    }
    if (err instanceof Error && err.message === "store_context_required") {
      console.error("getStore: store_context_required");
      return Response.json({ error: "store_context_required" }, { status: 500 });
    }
    throw err;
  }
}

export type IdContext = { params: Promise<{ id: string }> };

export type Api = { ctx: RequestContext; store: SessionStore };

/** The store for the active workspace. Local mode ignores the context and uses the file store. */
export function storeFor(ctx: RequestContext): SessionStore {
  return getStore(ctx.supabase ? { supabase: ctx.supabase, workspaceId: ctx.workspaceId, userId: ctx.userId } : undefined);
}

/**
 * requireContext first (401 signed out, 503 misconfigured, 403 no_workspace), then fn under handle().
 * Store calls go through api.store, which is scoped to the active workspace.
 */
export async function withApi(fn: (api: Api) => Promise<Response>): Promise<Response> {
  const ctx = await requireContext();
  if (ctx instanceof Response) return ctx;
  return handle(() => fn({ ctx, store: storeFor(ctx) }));
}

/**
 * The session's created_by within the active workspace, or undefined when the session is not visible there.
 * Session does not carry the creator, so supabase mode reads sessions.created_by directly (RLS applies).
 * Local mode: the creator is 'local'.
 */
async function sessionCreator(api: Api, id: string): Promise<string | null | undefined> {
  if (!isValidSessionId(id)) throw new InvalidSessionIdError(id);
  const { ctx, store } = api;
  if (!ctx.supabase) return (await store.getSession(id)) ? "local" : undefined;
  const { data, error } = await ctx.supabase
    .from("sessions")
    .select("created_by")
    .eq("id", id)
    .eq("workspace_id", ctx.workspaceId)
    .maybeSingle();
  if (error) throw new Error(`select sessions.created_by: ${error.message}`);
  if (!data) return undefined;
  return (data as { created_by: string | null }).created_by;
}

/**
 * Writes to a session (events, transcript, qa, off-record, vision, end, workmap, workmap/confirm):
 * the session creator or a workspace owner. A session outside the active workspace answers 404 with the
 * same body as a missing one, never 403.
 */
export async function requireCreatorOrOwner(api: Api, id: string): Promise<Response | null> {
  const creator = await sessionCreator(api, id);
  if (creator === undefined) return notFound(new SessionNotFoundError(id).message);
  return api.ctx.role === "owner" || creator === api.ctx.userId ? null : forbidden();
}
