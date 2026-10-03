// Shared schemas and helpers for the /api/agents route handlers (route files may only export handlers).
import { z } from "zod";
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
