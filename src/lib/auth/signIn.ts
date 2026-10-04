// Shared by the magic-link callback and the password login (/api/auth/bootstrap): after a session exists, read the
// memberships, run bootstrap_workspace once and pick the ws cookie for a newly accepted invite.
// Every caller (/auth/callback, /api/auth/bootstrap) gets the cache expiry: bootstrap may accept invites, so this
// user's cached memberships and the member list of the joined workspace are expired.
import type { SupabaseClient } from "@supabase/supabase-js";
import { revalidateScopes } from "@/lib/cache/readMostly";
import { bootstrapMemberships, readMemberships } from "./context";

export type SignInBootstrap = { ok: true; wsCookie: string | null } | { ok: false };

export async function bootstrapAfterSignIn(supabase: SupabaseClient, userId: string): Promise<SignInBootstrap> {
  // Same rule as getRequestContext: a membership read error is not zero memberships.
  const before = await readMemberships(supabase, userId);
  if (!before.ok) return { ok: false };
  const boot = await bootstrapMemberships(supabase);
  if (!boot.ok || boot.memberships.length === 0) return { ok: false };
  // An accepted invite adds a workspace the user was not in before; land there.
  // Deterministic pick: the lowest workspace_id among the new ones.
  const known = new Set(before.memberships.map((m) => m.workspaceId));
  const added = boot.memberships
    .map((m) => m.workspaceId)
    .filter((id) => !known.has(id))
    .sort();
  const wsCookie = added[0] ?? null;
  revalidateScopes(["memberships"], { userId, workspaceId: wsCookie ?? "" });
  if (wsCookie) revalidateScopes(["members"], { userId, workspaceId: wsCookie });
  return { ok: true, wsCookie };
}
