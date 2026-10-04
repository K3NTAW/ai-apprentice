import { agentAdminFor } from "@/lib/agents/admin";
import { withApi } from "../../session/_http";
import { adminErrors } from "../_lib";

export const runtime = "nodejs";

// Any member reads the workspace's deletion requests, newest first. Before the migration: an empty list.
export async function GET() {
  return withApi(async ({ ctx: rc }) =>
    adminErrors(async () => Response.json({ requests: await agentAdminFor(rc).listRequests() })),
  );
}
