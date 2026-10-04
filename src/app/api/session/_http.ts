// Shared helpers for the /api/session route handlers.
import type { z } from "zod";
import { type RequestContext, requireContext } from "@/lib/auth/context";
import { revalidateScopes, type Scope } from "@/lib/cache/readMostly";
import { serverTiming } from "@/lib/perf";
import {
  EmptyProcessPatchError,
  getStore,
  InvalidOffRecordRangeError,
  InvalidSessionIdError,
  InvalidWorkMapError,
  isValidSessionId,
  ProcessDeletedError,
  ProcessesUnavailableError,
  ProcessExistsError,
  ProcessNotFoundError,
  ProcessVersionConflictError,
  SessionLinkedError,
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
    if (err instanceof ProcessNotFoundError) return notFound(err.message);
    if (err instanceof ProcessVersionConflictError) return Response.json({ error: err.code, message: err.message }, { status: 409 });
    if (err instanceof ProcessExistsError) return Response.json({ error: err.code, message: err.message }, { status: 409 });
    if (err instanceof ProcessDeletedError) return Response.json({ error: err.code, message: err.message }, { status: 409 });
    if (err instanceof SessionLinkedError) return Response.json({ error: err.code, message: err.message }, { status: 409 });
    if (err instanceof InvalidWorkMapError) return badRequest(err.code);
    if (err instanceof EmptyProcessPatchError) return badRequest(err.code);
    // Migration 20261004030000_processes not applied: a stable 503, never a 500. The UI falls back to sessions.
    if (err instanceof ProcessesUnavailableError) return Response.json({ error: err.code, message: err.message }, { status: 503 });
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
  const t0 = performance.now();
  const ctx = await requireContext();
  const ctxAuth = performance.now() - t0;
  if (ctx instanceof Response) return withServerTiming(ctx, { "ctx-auth": ctxAuth, db: 0, total: ctxAuth });
  const db = { ms: 0 };
  const res = await handle(() => fn({ ctx, store: timedStore(storeFor(ctx), db) }));
  return withServerTiming(res, { "ctx-auth": ctxAuth, db: db.ms, total: performance.now() - t0 });
}

/** The store with the time of every async call added to acc.ms (calls that overlap are each counted). */
export function timedStore(store: SessionStore, acc: { ms: number }): SessionStore {
  return new Proxy(store, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver);
      if (typeof value !== "function") return value;
      return (...args: unknown[]) => {
        const t = performance.now();
        const out = value.apply(target, args);
        if (!(out instanceof Promise)) {
          acc.ms += performance.now() - t;
          return out;
        }
        return out.finally(() => {
          acc.ms += performance.now() - t;
        });
      };
    },
  });
}

/**
 * withApi for writes: after a 2xx response the scopes' read-mostly caches of the active workspace are expired
 * (sessions: sidebar recents and agent stats; agents: the agent list), so the next page render reads fresh data.
 */
export async function withMutation(scopes: Scope[], fn: (api: Api) => Promise<Response>): Promise<Response> {
  return withApi(async (api) => {
    const res = await fn(api);
    if (res.ok) revalidateScopes(scopes, api.ctx);
    return res;
  });
}

/**
 * Server-Timing (ms): ctx-auth is requireContext (getUser plus memberships), db is the sum of the store calls,
 * total is requireContext start to response. A response with immutable headers is copied first.
 */
export function withServerTiming(res: Response, timings: Record<string, number>): Response {
  const value = serverTiming(timings);
  try {
    res.headers.append("Server-Timing", value);
    return res;
  } catch {
    const copy = new Response(res.body, res);
    copy.headers.append("Server-Timing", value);
    return copy;
  }
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
