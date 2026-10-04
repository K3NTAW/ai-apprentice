import { z } from "zod";
import { requireRole } from "@/lib/auth/context";
import { backfillProcesses } from "@/lib/processes/server";
import { parseBody, withMutation } from "../../session/_http";
import { agentErrors } from "../../agents/_lib";

export const runtime = "nodejs";

const BackfillBody = z.strictObject({ agent_id: z.string().optional() });

// Owner only. One-time backfill: a process for each confirmed capture session not linked to a process yet
// (optionally of one agent). Idempotent: a second call creates nothing. 503 until the migration is applied.
export async function POST(req: Request) {
  return withMutation(["agents", "sessions"], async ({ ctx, store }) => {
    const denied = requireRole(ctx, ["owner"]);
    if (denied) return denied;
    // An empty body backfills every agent.
    const body = (await req.clone().text()).trim() === "" ? { ok: true as const, data: {} } : await parseBody(req, BackfillBody);
    if (!body.ok) return body.res;
    return agentErrors(async () => {
      const created = await backfillProcesses(store, body.data);
      return Response.json({ created: created.length, processes: created });
    });
  });
}
