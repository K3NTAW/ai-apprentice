// Shared schemas and helpers for the /api/agents route handlers (route files may only export handlers).
import { z } from "zod";
import { DeleteAgentError, RequestNotFoundError, SettingsUnavailableError } from "@/lib/agents/admin";
import { AgentNotFoundError } from "@/lib/store";
import { AGENT_EXPERT_NAME_MAX, AGENT_NAME_MAX, AGENT_ROLE_MAX, AvatarSchema } from "@/lib/types";
import { notFound } from "../session/_http";

const Name = z.string().trim().min(1).max(AGENT_NAME_MAX);
const Role = z.string().trim().min(1).max(AGENT_ROLE_MAX);
const ExpertName = z.string().trim().max(AGENT_EXPERT_NAME_MAX);

// Strict objects: unknown keys answer 400. The avatar is always a whole AvatarSchema.
export const CreateAgentBody = z.strictObject({
  name: Name,
  role: Role,
  expert_name: ExpertName.optional(),
  avatar: AvatarSchema,
});

/** PATCH: given keys replace the stored value; avatar is replaced as a whole; expert_name null clears it. */
export const PatchAgentBody = z
  .strictObject({
    name: Name.optional(),
    role: Role.optional(),
    expert_name: ExpertName.nullable().optional(),
    avatar: AvatarSchema.optional(),
  })
  .refine((b) => Object.values(b).some((v) => v !== undefined), { message: "nothing to update" });

/** A missing agent and an agent of another workspace answer the same 404. */
export async function agentErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof AgentNotFoundError) return notFound(err.message);
    throw err;
  }
}

/** Keys only an owner may change (Privacy and retention). Experts change Questions while training. */
export const OWNER_ONLY_SETTINGS = ["redact_names_emails", "redact_iban_phone", "off_record_phrase", "retention_days"] as const;

/** Stable error codes for the settings and deletion routes; never a 500 for a missing migration. */
export async function adminErrors(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await agentErrors(fn);
  } catch (err) {
    if (err instanceof SettingsUnavailableError)
      return Response.json({ error: err.code, message: err.message }, { status: 503 });
    if (err instanceof RequestNotFoundError) return notFound(err.message);
    if (err instanceof DeleteAgentError) {
      console.error(err.message);
      return Response.json({ error: "delete_failed", step: err.step, message: "Deletion stopped part way. Nothing after that step was removed; try again." }, { status: 502 });
    }
    throw err;
  }
}
