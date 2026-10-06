// GET /api/workspace/cost?days=N: daily cost rows of the active workspace from usage_cost_daily (docs/checks/cost-meter.md).
// Any member role. Reads through the user client (the view is security_invoker, so RLS applies) and still filters by the
// active workspace in the query, and drops any row of another workspace that still comes back.
import { requireContext } from "@/lib/auth/context";
import { log, withRequestLog } from "@/lib/log";
import { COST_ROW_LIMIT, mapCostRow, parseDays, zurichCutoff, type CostResponse, type CostRow } from "./cost";

export const runtime = "nodejs";

async function handleGET(req: Request): Promise<Response> {
  const ctx = await requireContext();
  if (ctx instanceof Response) return ctx;
  const days = parseDays(new URL(req.url).searchParams.get("days"));
  if (days === null) return Response.json({ error: "invalid days" }, { status: 400 });
  if (ctx.mode === "local" || !ctx.supabase) {
    return Response.json({ days, truncated: false, rows: [], local: true } satisfies CostResponse);
  }
  const { data, error } = await ctx.supabase
    .from("usage_cost_daily")
    .select("workspace_id, day, kind, events, input_tokens, output_tokens, cache_read_tokens, voice_seconds, bytes, chf, unpriced_events")
    .eq("workspace_id", ctx.workspaceId)
    .gte("day", zurichCutoff(days))
    .order("day", { ascending: false })
    .limit(COST_ROW_LIMIT);
  if (error) {
    log.error("workspace cost", { error: error.message });
    return Response.json({ error: "cost unavailable" }, { status: 500 });
  }
  const list = Array.isArray(data) ? (data as unknown[]) : [];
  const own = list.filter((r) => (r as { workspace_id?: unknown } | null)?.workspace_id === ctx.workspaceId);
  const rows = own.map(mapCostRow).filter((r): r is CostRow => r !== null);
  return Response.json({ days, truncated: list.length >= COST_ROW_LIMIT, rows } satisfies CostResponse);
}

export const GET = withRequestLog("/api/workspace/cost", handleGET);
