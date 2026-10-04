// Shared schemas for the /api/processes route handlers (route files may only export handlers).
// Errors: ProcessesUnavailableError answers 503 'processes not available yet', ProcessNotFoundError 404 and
// ProcessVersionConflictError 409 (handle()). confirmed is never accepted: it follows workmap.confirmed_by_expert.
import { z } from "zod";
import { PROCESS_CHANGE_KINDS, PROCESS_TITLE_MAX } from "@/lib/store";
import { WorkMapSchema } from "@/lib/types";

const Title = z.string().trim().min(1).max(PROCESS_TITLE_MAX);

export const CreateProcessBody = z.strictObject({
  agent_id: z.string(),
  title: Title,
  workmap: WorkMapSchema,
  source_session_id: z.string().optional(),
});

/**
 * PATCH: given keys replace the stored value; a new workmap adds a version (change_kind defaults to 'edited').
 * expected_version: the version the edit is based on; a stale one answers 409 and writes nothing.
 * archived is an owner action.
 */
export const PatchProcessBody = z
  .strictObject({
    title: Title.optional(),
    workmap: WorkMapSchema.optional(),
    expected_version: z.number().int().min(1).optional(),
    archived: z.boolean().optional(),
    change_kind: z.enum(PROCESS_CHANGE_KINDS).optional(),
    source_session_id: z.string().optional(),
  })
  .refine((b) => b.title !== undefined || b.workmap !== undefined || b.archived !== undefined, {
    message: "nothing to update",
  });

/** POST /api/processes/from-session: the expert's choice at the end of the debrief. add and replace need process_id. */
export const SaveFromSessionBody = z
  .strictObject({
    session_id: z.string(),
    choice: z.enum(["add", "replace", "new"]),
    process_id: z.string().optional(),
    expected_version: z.number().int().min(1).optional(),
    preview: z.boolean().optional(),
  })
  .refine((b) => b.choice === "new" || !!b.process_id, { message: "process_id required" });
