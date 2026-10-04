// Read-mostly data (memberships, the agents input, recent sessions) cached across requests for a few seconds.
// Every key carries the user id and the workspace id, so nothing is shared across users or workspaces;
// mutations revalidate the tags (revalidateScopes). Callers cache in supabase mode only; local mode reads the file store.
// Outside a Next server (vitest) unstable_cache has no incremental cache and the read runs directly.
import { revalidateTag, unstable_cache } from "next/cache";

export const READ_MOSTLY_SECONDS = 5;

/** workspace: the workspace's own name and city, shown to every member (expired by a rename). */
export type Scope = "agents" | "sessions" | "members" | "memberships" | "workspace";
export type CacheIds = { userId: string; workspaceId: string };

export const cacheTag = {
  agents: (workspaceId: string) => `ws:${workspaceId}:agents`,
  sessions: (workspaceId: string) => `ws:${workspaceId}:sessions`,
  members: (workspaceId: string) => `ws:${workspaceId}:members`,
  memberships: (userId: string) => `user:${userId}:memberships`,
  workspace: (workspaceId: string) => `workspace:${workspaceId}:meta`,
};

export function tagFor(scope: Scope, ids: CacheIds): string {
  return scope === "memberships" ? cacheTag.memberships(ids.userId) : cacheTag[scope](ids.workspaceId);
}

export function cacheKey(name: string, ids: CacheIds): string[] {
  if (!ids.userId || !ids.workspaceId) throw new Error("cache key needs a user id and a workspace id");
  return [name, `user:${ids.userId}`, `ws:${ids.workspaceId}`];
}

/** Thrown inside a cached read to return a value without caching it (errors, empty bootstrap results). */
export class Uncacheable<T> {
  constructor(readonly value: T) {}
}

const missingCache = (e: unknown) =>
  e instanceof Error && /incrementalCache missing|static generation store missing|work ?store missing/i.test(e.message);

async function settle<T>(run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (e) {
    if (e instanceof Uncacheable) return e.value as T;
    throw e;
  }
}

/** extraTags: tags beyond the scopes of ids, e.g. the meta tag of every workspace in a membership list. */
export async function readMostly<T>(name: string, ids: CacheIds, scopes: Scope[], read: () => Promise<T>, extraTags: string[] = []): Promise<T> {
  const cached = unstable_cache(read, cacheKey(name, ids), {
    tags: [...scopes.map((s) => tagFor(s, ids)), ...extraTags],
    revalidate: READ_MOSTLY_SECONDS,
  });
  try {
    return await settle(cached);
  } catch (e) {
    if (missingCache(e)) return settle(read);
    throw e;
  }
}

/** Expires the scopes' tags now. Outside a Next server there is nothing to expire. */
export function revalidateScopes(scopes: Scope[], ids: CacheIds): void {
  for (const scope of scopes) {
    try {
      revalidateTag(tagFor(scope, ids), { expire: 0 });
    } catch (e) {
      if (!missingCache(e)) console.error("revalidateTag:", e instanceof Error ? e.message : e);
    }
  }
}
