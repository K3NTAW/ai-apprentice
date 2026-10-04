// Server only. Loads the agents of the active workspace plus the control room inputs (sessions, members, creators)
// and the processes (none while migration 20261004030000_processes is not applied; callers then use sessions only).
import type { RequestContext } from "@/lib/auth/context";
import { readMostly } from "@/lib/cache/readMostly";
import { listProcessesOrNone } from "@/lib/processes/server";
import { getStore, type Process } from "@/lib/store";
import type { Agent } from "@/lib/types";
import { loadDashboardInput, type DashboardInput } from "./load";

export type AgentsInput = DashboardInput & { agents: Agent[]; processes: Process[] };

async function readAgentsInput(ctx: RequestContext): Promise<AgentsInput> {
  const supabase = ctx.mode === "supabase" ? ctx.supabase : null;
  const store = supabase ? getStore({ supabase, workspaceId: ctx.workspaceId, userId: ctx.userId }) : getStore();
  const [agents, input, processes] = await Promise.all([store.listAgents(), loadDashboardInput(ctx), listProcessesOrNone(store)]);
  return { ...input, agents, processes };
}

/**
 * The agent list and the inputs of the agent stats. Supabase mode caches them for a few seconds per user and
 * workspace; agent writes expire 'agents', session writes 'sessions', member changes 'members'.
 */
export async function loadAgentsInput(ctx: RequestContext): Promise<AgentsInput> {
  if (ctx.mode !== "supabase" || !ctx.supabase) return readAgentsInput(ctx);
  return readMostly("agents-input", ctx, ["agents", "sessions", "members"], () => readAgentsInput(ctx));
}
