// Create workspace input, shared by the sidebar dialog and POST /api/workspace (public.create_workspace checks the same).
import { z } from "zod";

export const WORKSPACE_NAME_MAX = 60;
export const WORKSPACE_CITY_MAX = 60;
/** Mirrors the limit in create_workspace (supabase/migrations/20261004020000_workspace_create.sql). */
export const OWNED_WORKSPACE_LIMIT = 10;

export const CreateWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(WORKSPACE_NAME_MAX),
  city: z
    .string()
    .trim()
    .max(WORKSPACE_CITY_MAX)
    .nullish()
    .transform((c) => c || null),
});
export type CreateWorkspaceInput = z.infer<typeof CreateWorkspaceInput>;

/** PATCH /api/workspace: the name is required, the city is left alone when absent and cleared when empty or null. */
export const RenameWorkspaceInput = z.object({
  name: z.string().trim().min(1).max(WORKSPACE_NAME_MAX),
  city: z
    .string()
    .trim()
    .max(WORKSPACE_CITY_MAX)
    .nullish()
    .transform((c) => (c === undefined ? undefined : c || null)),
});
export type RenameWorkspaceInput = z.infer<typeof RenameWorkspaceInput>;

/** The dialog's field message, or null when the input is valid. */
export function workspaceInputError(input: { name: string; city?: string | null }): string | null {
  const name = input.name.trim();
  if (!name) return "Enter a workspace name.";
  if (name.length > WORKSPACE_NAME_MAX) return `Use at most ${WORKSPACE_NAME_MAX} characters for the name.`;
  if ((input.city ?? "").trim().length > WORKSPACE_CITY_MAX) return `Use at most ${WORKSPACE_CITY_MAX} characters for the city.`;
  return null;
}

/** 'Finance Ops · Zug'; the city is left out when absent or already part of the name. */
export function workspaceLabel(name: string, city?: string | null): string {
  const c = city?.trim();
  return c && !name.endsWith(` · ${c}`) ? `${name} · ${c}` : name;
}

/** Postgres and PostgREST codes for a function that does not exist (migration not applied yet). */
export const isMissingFunction = (code: string | undefined) => code === "PGRST202" || code === "42883";
