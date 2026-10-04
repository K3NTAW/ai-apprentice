// Per-request auth and workspace context for server components and route handlers.
// Only auth.getUser() is used, never getSession(): getUser revalidates the token with Supabase Auth.
// Page renders reuse the user the proxy verified in the same request (signed forwarded header), so a page request
// costs one getUser in total; route handlers (requireContext) always call getUser themselves.
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { cache } from "react";
import type { z } from "zod";
import { appMode } from "@/lib/supabase/env";
import { readMostly, Uncacheable } from "@/lib/cache/readMostly";
import { timed } from "@/lib/perf";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { WS_COOKIE } from "./cookies";
import { FORWARDED_USER_HEADER, verifyForwardedUser, type ForwardedUser } from "./forwardedUser";

export type Role = "owner" | "expert" | "learner";
export type Membership = { workspaceId: string; name: string; role: Role };

export type RequestContext = {
  mode: "local" | "supabase";
  userId: string;
  email: string | null;
  /** When the user's address was confirmed (Supabase email_confirmed_at); null when never. Unset in local mode. */
  emailConfirmedAt?: string | null;
  workspaceId: string;
  workspaceName: string;
  role: Role;
  supabase: SupabaseClient | null;
  memberships: Membership[];
};

export type ContextResult =
  | { kind: "ok"; ctx: RequestContext }
  | { kind: "signed_out" }
  | { kind: "misconfigured" }
  | { kind: "no_workspace" };

const ROLES: readonly Role[] = ["owner", "expert", "learner"];
const isRole = (r: unknown): r is Role => typeof r === "string" && (ROLES as readonly string[]).includes(r);

type MemberRow = {
  workspace_id: string;
  role: string;
  created_at: string;
  workspaces: { name: string } | { name: string }[] | null;
};
type BootstrapRow = { workspace_id: string; name: string; role: string };

/** The user's memberships ordered by created_at then workspace_id. A query error is not zero memberships. */
export async function readMemberships(
  supabase: SupabaseClient,
  userId: string,
): Promise<{ ok: true; memberships: Membership[] } | { ok: false }> {
  const { data, error } = await supabase
    .from("workspace_members")
    .select("workspace_id, role, created_at, workspaces(name)")
    .eq("user_id", userId)
    .order("created_at", { ascending: true })
    .order("workspace_id", { ascending: true });
  if (error || !Array.isArray(data)) {
    if (error) console.error("readMemberships:", error.message);
    return { ok: false };
  }
  const memberships: Membership[] = [];
  for (const row of data as MemberRow[]) {
    if (!isRole(row.role)) continue;
    const ws = Array.isArray(row.workspaces) ? row.workspaces[0] : row.workspaces;
    memberships.push({ workspaceId: row.workspace_id, name: ws?.name ?? "", role: row.role });
  }
  return { ok: true, memberships };
}

/** Calls bootstrap_workspace once. It accepts pending invites and creates a personal workspace when needed. */
export async function bootstrapMemberships(
  supabase: SupabaseClient,
): Promise<{ ok: true; memberships: Membership[] } | { ok: false }> {
  const { data, error } = await supabase.rpc("bootstrap_workspace");
  if (error || !Array.isArray(data)) {
    if (error) console.error("bootstrap_workspace:", error.message);
    return { ok: false };
  }
  const memberships = (data as BootstrapRow[])
    .filter((r) => isRole(r.role))
    .map((r) => ({ workspaceId: r.workspace_id, name: r.name, role: r.role as Role }));
  return { ok: true, memberships };
}

/** The ws cookie wins only when it names one of the memberships. */
export function pickActive(memberships: Membership[], cookieValue: string | undefined): Membership {
  return memberships.find((m) => m.workspaceId === cookieValue) ?? memberships[0];
}

function localContext(): RequestContext {
  return {
    mode: "local",
    userId: "local",
    email: null,
    workspaceId: "local",
    workspaceName: "local",
    role: "owner",
    supabase: null,
    memberships: [{ workspaceId: "local", name: "local", role: "owner" }],
  };
}

/** The proxy-verified user of this request, or null (no header, bad signature, expired, outside a request). */
async function forwardedUser(): Promise<ForwardedUser | null> {
  try {
    return verifyForwardedUser((await headers()).get(FORWARDED_USER_HEADER));
  } catch {
    return null;
  }
}

type ReadMemberships = { ok: true; memberships: Membership[] } | { ok: false };

/**
 * Page path: memberships cached for a few seconds per user and requested workspace (tag memberships:<user>, expired
 * by bootstrap and member removal). Errors and empty results are never cached.
 */
export function cachedMemberships(supabase: SupabaseClient, userId: string, wsCookie: string | undefined): Promise<ReadMemberships> {
  return readMostly("memberships", { userId, workspaceId: wsCookie ?? "none" }, ["memberships"], async () => {
    const read = await readMemberships(supabase, userId);
    if (!read.ok || read.memberships.length === 0) throw new Uncacheable(read);
    return read;
  });
}

type ResolveOpts = { fresh: boolean };

async function resolveRequestContext(opts: ResolveOpts): Promise<ContextResult> {
  const mode = appMode();
  if (mode === "local") return { kind: "ok", ctx: localContext() };
  if (mode !== "supabase") return { kind: "misconfigured" };

  let supabase: SupabaseClient;
  try {
    supabase = await createSupabaseServerClient();
  } catch {
    return { kind: "misconfigured" };
  }

  // A thrown getUser counts as signed out.
  let user: { id: string; email?: string | null; email_confirmed_at?: string | null } | null = opts.fresh
    ? null
    : await forwardedUser();
  if (!user) {
    user = await timed("ctx-auth", async () => {
      try {
        const { data, error } = await supabase.auth.getUser();
        return error ? null : (data?.user ?? null);
      } catch {
        return null;
      }
    });
  }
  if (!user) return { kind: "signed_out" };

  const cookieStore = await cookies();
  const wsCookie = cookieStore.get(WS_COOKIE)?.value;
  const userId = user.id;
  const read = await timed("db", () =>
    opts.fresh ? readMemberships(supabase, userId) : cachedMemberships(supabase, userId, wsCookie),
  );
  if (!read.ok) return { kind: "no_workspace" };
  let memberships = read.memberships;
  if (memberships.length === 0) {
    const boot = await bootstrapMemberships(supabase);
    if (!boot.ok) return { kind: "no_workspace" };
    memberships = boot.memberships;
  }
  if (memberships.length === 0) return { kind: "no_workspace" };

  const active = pickActive(memberships, wsCookie);
  return {
    kind: "ok",
    ctx: {
      mode: "supabase",
      userId: user.id,
      email: user.email ?? null,
      emailConfirmedAt: user.email_confirmed_at ?? null,
      workspaceId: active.workspaceId,
      workspaceName: active.name,
      role: active.role,
      supabase,
      memberships,
    },
  };
}

/**
 * Read path for server components (AppShell, pages, loaders): memoized per request with React cache(), so one render
 * resolves the user, memberships and workspace once (one getUser) however many components ask. cache() keys on the
 * React server request: nothing is shared across requests, and outside a server render it does not memoize at all.
 */
export const getRequestContext = cache(() => resolveRequestContext({ fresh: false }));

/**
 * Always resolves again: its own getUser (never the forwarded user) and memberships straight from the database.
 * requireContext (route handlers, where every mutation lives) uses it.
 */
export const getFreshRequestContext = () => resolveRequestContext({ fresh: true });

const json = (error: string, status: number) => Response.json({ error }, { status });

/**
 * Route handlers: the fresh context, never the request cache, so mutating paths (bootstrap, workspace switch,
 * invites, session writes) always see the current user and memberships.
 */
export async function requireContext(): Promise<RequestContext | Response> {
  const result = await getFreshRequestContext();
  switch (result.kind) {
    case "ok":
      return result.ctx;
    case "signed_out":
      return json("unauthorized", 401);
    case "misconfigured":
      return json("supabase_not_configured", 503);
    case "no_workspace":
      return json("no_workspace", 403);
  }
}

export function requireRole(ctx: RequestContext, roles: readonly Role[]): Response | null {
  return roles.includes(ctx.role) ? null : json("forbidden", 403);
}

// ---------------------------------------------------------------------------
// Helpers for the /api/workspace route handlers (route files may only export handlers).
// ---------------------------------------------------------------------------

export type SupabaseContext = RequestContext & { mode: "supabase"; supabase: SupabaseClient };

/** requireContext, then 400 local_mode, then requireRole when roles are given. */
export async function requireWorkspaceApi(roles?: readonly Role[]): Promise<SupabaseContext | Response> {
  const ctx = await requireContext();
  if (ctx instanceof Response) return ctx;
  if (ctx.mode === "local" || !ctx.supabase) return json("local_mode", 400);
  if (roles) {
    const denied = requireRole(ctx, roles);
    if (denied) return denied;
  }
  return ctx as SupabaseContext;
}

export async function parseJsonBody<T>(req: Request, schema: z.ZodType<T>): Promise<T | Response> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json("invalid_input", 400);
  }
  const parsed = schema.safeParse(body);
  return parsed.success ? parsed.data : json("invalid_input", 400);
}

/** Logs the message server side; the client only sees 'internal'. */
export function internalError(where: string, error: { message?: string } | null | undefined): Response {
  console.error(`${where}:`, error?.message ?? "no rows returned");
  return json("internal", 500);
}

// ---------------------------------------------------------------------------
// /workspace view model (pure, used by src/app/workspace/page.tsx).
// Decision: member emails are shown to owners only. Other roles see their own
// address and the first 8 chars of every other user id.
// ---------------------------------------------------------------------------

export const MEMBER_DISPLAY_LIMIT = 50;

export type MemberRowInput = { user_id: string; role: string };
export type InviteRowInput = { id: string; email: string; role: string; created_at: string };

export type WorkspaceView = {
  workspaceId: string;
  workspaceName: string;
  email: string | null;
  role: Role;
  isOwner: boolean;
  members: { userId: string; label: string; role: string; isSelf: boolean }[];
  truncated: boolean;
  invites: { id: string; email: string; role: string; createdAt: string }[];
  memberships: Membership[];
};

export const shortId = (userId: string) => userId.slice(0, 8);

/** User ids whose address may be looked up: owners only, at most MEMBER_DISPLAY_LIMIT, never the viewer. */
export function emailLookupIds(ctx: Pick<RequestContext, "role" | "userId">, members: MemberRowInput[]): string[] {
  if (ctx.role !== "owner") return [];
  return members
    .slice(0, MEMBER_DISPLAY_LIMIT)
    .map((m) => m.user_id)
    .filter((id) => id !== ctx.userId);
}

export function buildWorkspaceView(
  ctx: Pick<RequestContext, "workspaceId" | "workspaceName" | "email" | "role" | "userId" | "memberships">,
  members: MemberRowInput[],
  invites: InviteRowInput[],
  emails: ReadonlyMap<string, string>,
): WorkspaceView {
  const isOwner = ctx.role === "owner";
  return {
    workspaceId: ctx.workspaceId,
    workspaceName: ctx.workspaceName,
    email: ctx.email,
    role: ctx.role,
    isOwner,
    members: members.slice(0, MEMBER_DISPLAY_LIMIT).map((m) => {
      const isSelf = m.user_id === ctx.userId;
      const email = isSelf ? ctx.email : isOwner ? emails.get(m.user_id) : undefined;
      return { userId: m.user_id, label: email ?? shortId(m.user_id), role: m.role, isSelf };
    }),
    truncated: members.length > MEMBER_DISPLAY_LIMIT,
    invites: isOwner ? invites.map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.created_at })) : [],
    memberships: ctx.memberships,
  };
}
