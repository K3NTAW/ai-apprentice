// Shared schemas for the /api/processes route handlers (route files may only export handlers).
// Errors: ProcessesUnavailableError answers 503 'processes not available yet' and ProcessNotFoundError 404 (handle()).
import { z } from "zod";
import { PROCESS_CHANGE_KINDS, PROCESS_TITLE_MAX } from "@/lib/store";
import { WorkMapSchema } from "@/lib/types";

const Title = z.string().trim().min(1).max(PROCESS_TITLE_MAX);

export const CreateProcessBody = z.strictObject({
  agent_id: z.string(),
  title: Title,
  workmap: WorkMapSchema,
  confirmed: z.boolean().optional(),
  source_session_id: z.string().optional(),
});

/** PATCH: given keys replace the stored value; a new workmap adds a version (change_kind defaults to 'edited'). */
export const PatchProcessBody = z
  .strictObject({
    title: Title.optional(),
    workmap: WorkMapSchema.optional(),
    confirmed: z.boolean().optional(),
    archived: z.boolean().optional(),
    change_kind: z.enum(PROCESS_CHANGE_KINDS).optional(),
    source_session_id: z.string().optional(),
  })
  .refine((b) => b.title !== undefined || b.workmap !== undefined || b.confirmed !== undefined || b.archived !== undefined, {
    message: "nothing to update",
  });
