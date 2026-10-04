import { z } from "zod";
import { agentAdminFor } from "@/lib/agents/admin";
import { requireRole } from "@/lib/auth/context";
import { notFound, parseBody, withMutation, type IdContext } from "../../../session/_http";
import { adminErrors } from "../../_lib";

export const runtime = "nodejs";

const Decision = z.strictObject({ status: z.enum(["approved", "declined"]) });

// Owner only. Approve runs the same delete as the owner's Delete button, then records the decision; when the
// delete stops part way the request stays pending (502 delete_failed) and Approve can be pressed again.
// An agent that is already gone is approved without a delete.
export async function PATCH(req: Request, ctx: IdContext) {
  return withMutation(["agents", "sessions"], async ({ ctx: rc }) => {
    const denied = requireRole(rc, ["owner"]);
    if (denied) return denied;
    const { id } = await ctx.params;
    const body = await parseBody(req, Decision);
    if (!body.ok) return body.res;
    return adminErrors(async () => {
      const admin = agentAdminFor(rc);
      const request = await admin.getRequest(id);
      if (!request || request.status !== "pending") return notFound(`deletion request not found: ${id}`);
      const result = body.data.status === "approved" && request.agent_id ? await admin.deleteAgentWithData(request.agent_id) : null;
      const decided = await admin.decide(id, body.data.status);
      return Response.json({ request: decided, deleted: result?.deleted ?? false });
    });
  });
}
