// Server only. Loads the agents of the active workspace plus the control room inputs (sessions, members, creators),
// and separately the processes (loadAgentProcesses), so the agents loader keeps its query count.
import type { RequestContext } from "@/lib/auth/context";
import { readMostly } from "@/lib/cache/readMostly";
import { listProcessesOrNone } from "@/lib/processes/server";
import { getStore, type Process } from "@/lib/store";
import type { Agent } from "@/lib/types";
import { loadDashboardInput, type DashboardInput } from "./load";

export type AgentsInput = DashboardInput & { agents: Agent[] };

async function readAgentsInput(ctx: RequestContext): Promise<AgentsInput> {
  const supabase = ctx.mode === "supabase" ? ctx.supabase : null;
  const store = supabase ? getStore({ supabase, workspaceId: ctx.workspaceId, userId: ctx.userId }) : getStore();
  const [agents, input] = await Promise.all([store.listAgents(), loadDashboardInput(ctx)]);
  return { ...input, agents };
}

/**
 * The agent list and the inputs of the agent stats. Supabase mode caches them for a few seconds per user and
 * workspace; agent writes expire 'agents', session writes 'sessions', member changes 'members'.
 */
export async function loadAgentsInput(ctx: RequestContext): Promise<AgentsInput> {
  if (ctx.mode !== "supabase" || !ctx.supabase) return readAgentsInput(ctx);
  return readMostly("agents-input", ctx, ["agents", "sessions", "members"], () => readAgentsInput(ctx));
}

const storeOf = (ctx: RequestContext) => {
  const supabase = ctx.mode === "supabase" ? ctx.supabase : null;
  return supabase ? getStore({ supabase, workspaceId: ctx.workspaceId, userId: ctx.userId }) : getStore();
};

/**
 * Every process of the workspace (archived included; agentWorkMaps and agentStatus skip those), one paged query.
 * None while migration 20261004030000_processes is not applied: the callers then use sessions only. Cached like
 * loadAgentsInput; process writes expire 'agents' and 'sessions'.
 */
export async function loadAgentProcesses(ctx: RequestContext): Promise<Process[]> {
  const read = () => listProcessesOrNone(storeOf(ctx), { include_archived: true });
  if (ctx.mode !== "supabase" || !ctx.supabase) return read();
  return readMostly("agent-processes", ctx, ["agents", "sessions"], read);
}
