// Sidebar menu actions, kept free of React so the shell tests call them with fakes (the Vitest environment is node).
import { WORKSPACE_NAME_MAX, workspaceInputError } from "@/lib/workspace/create";

type Fetch = (url: string, init: RequestInit) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
export type MenuDeps = { fetch: Fetch; reload: () => void };

const post = (deps: MenuDeps, url: string, body: unknown) =>
  deps.fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).catch(() => null);

/** POST /api/workspace/active, then reload. The active workspace is a no-op. */
export async function switchWorkspace(workspaceId: string, activeId: string | null, deps: MenuDeps): Promise<{ ok: boolean }> {
  if (workspaceId === activeId) return { ok: true };
  const res = await post(deps, "/api/workspace/active", { workspaceId });
  if (!res?.ok) return { ok: false };
  deps.reload();
  return { ok: true };
}

/** Validates, POST /api/workspace (the route also sets the active workspace cookie), then reloads into it. */
export async function createWorkspace(input: { name: string; city: string }, deps: MenuDeps): Promise<{ ok: true } | { ok: false; error: string }> {
  const invalid = workspaceInputError(input);
  if (invalid) return { ok: false, error: invalid };
  const res = await post(deps, "/api/workspace", { name: input.name.trim(), city: input.city.trim() || null });
  if (!res) return { ok: false, error: "Could not reach the server." };
  if (res.status === 503) return { ok: false, error: "Workspace creation is not available yet." };
  if (res.status === 409) return { ok: false, error: "You already own 10 workspaces." };
  if (res.status === 400) return { ok: false, error: "Check the name and city." };
  if (!res.ok) return { ok: false, error: "Could not create the workspace." };
  deps.reload();
  return { ok: true };
}

/**
 * PATCH /api/workspace (owner only). Validates first; the caller refreshes the page on ok. initialCity is the city
 * the form started with: an empty city that was empty before is left out of the body (the server keeps it as is);
 * one that was set before is sent as null (cleared).
 */
export async function renameWorkspace(
  input: { name: string; city: string; initialCity?: string | null },
  deps: Pick<MenuDeps, "fetch">,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const invalid = workspaceInputError(input);
  if (invalid) return { ok: false, error: invalid };
  const res = await deps
    .fetch("/api/workspace", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(renameBody(input)),
    })
    .catch(() => null);
  if (!res) return { ok: false, error: "Could not reach the server." };
  if (res.status === 403) return { ok: false, error: "Only owners can rename the workspace." };
  if (res.status === 400) return { ok: false, error: "Check the name and city." };
  if (res.status === 503) return { ok: false, error: "City is not available yet." };
  if (!res.ok) return { ok: false, error: "Could not save the workspace." };
  return { ok: true };
}

export const DISPLAY_NAME_MAX = WORKSPACE_NAME_MAX;

type Auth = { updateUser(attrs: { data: { full_name: string } }): Promise<{ error: { message: string } | null }> };

/** Saves user_metadata.full_name through supabase.auth.updateUser. */
export async function saveDisplayName(name: string, auth: Auth): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const full = name.trim();
  if (!full) return { ok: false, error: "Enter a name." };
  if (full.length > DISPLAY_NAME_MAX) return { ok: false, error: `Use at most ${DISPLAY_NAME_MAX} characters.` };
  try {
    const { error } = await auth.updateUser({ data: { full_name: full } });
    return error ? { ok: false, error: "Could not save the name." } : { ok: true, name: full };
  } catch {
    return { ok: false, error: "Could not save the name." };
  }
}

/** user_metadata.full_name, else the address local part capitalised ('sabine.keller' -> 'Sabine Keller'). */
export function displayName(fullName: string | null | undefined, email: string | null | undefined, fallback: string): string {
  if (fullName?.trim()) return fullName.trim();
  const words = (email ?? "").split("@")[0]!.split(/[._\-+]+/).filter(Boolean);
  return words.length ? words.map((w) => w[0]!.toUpperCase() + w.slice(1)).join(" ") : fallback;
}

/** 'Sabine Keller' -> 'SK', 'Sabine' -> 'SA'. */
export function nameInitials(name: string, fallback = "AA"): string {
  const parts = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  if (parts.length >= 2) return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  return (parts[0]?.slice(0, 2) || fallback).toUpperCase();
}

/** The PATCH body: trimmed name; city trimmed, null when cleared, absent when empty and unchanged. */
export function renameBody(input: { name: string; city: string; initialCity?: string | null }): { name: string; city?: string | null } {
  const name = input.name.trim();
  const city = input.city.trim();
  if (!city && !(input.initialCity ?? "").trim()) return { name };
  return { name, city: city || null };
}
