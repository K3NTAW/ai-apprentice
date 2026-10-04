import { agentAdminFor } from "@/lib/agents/admin";
import { AgentSettingsPatch } from "@/lib/agents/settings";
import { requireRole } from "@/lib/auth/context";
import { notFound, parseBody, withApi, withMutation, type IdContext } from "../../../session/_http";
import { adminErrors, OWNER_ONLY_SETTINGS } from "../../_lib";

export const runtime = "nodejs";

// Any member reads. Before migration 20261004010000: the defaults with available false (never a 500).
export async function GET(_req: Request, ctx: IdContext) {
  return withApi(async ({ ctx: rc, store }) => {
    const { id } = await ctx.params;
    if (!(await store.getAgent(id))) return notFound(`agent not found: ${id}`);
    return adminErrors(async () => {
      const { settings, available } = await agentAdminFor(rc).getSettings(id);
      return Response.json(
        available
          ? { settings, available }
          : { settings, available, error: "settings_unavailable", message: "Settings are not available yet. Defaults apply until the database is updated." },
      );
    });
  });
}

// Merge patch: only the given keys change. Owner or expert; Privacy and retention keys are owner only.
// 503 settings_unavailable until the migration is applied.
export async function PATCH(req: Request, ctx: IdContext) {
  return withMutation(["agents"], async ({ ctx: rc, store }) => {
    const denied = requireRole(rc, ["owner", "expert"]);
    if (denied) return denied;
    const { id } = await ctx.params;
    const body = await parseBody(req, AgentSettingsPatch);
    if (!body.ok) return body.res;
    if (rc.role !== "owner" && OWNER_ONLY_SETTINGS.some((k) => body.data[k] !== undefined))
      return Response.json({ error: "forbidden", message: "Only the workspace owner changes privacy and retention." }, { status: 403 });
    if (!(await store.getAgent(id))) return notFound(`agent not found: ${id}`);
    return adminErrors(async () => Response.json({ settings: await agentAdminFor(rc).patchSettings(id, body.data), available: true }));
  });
}
