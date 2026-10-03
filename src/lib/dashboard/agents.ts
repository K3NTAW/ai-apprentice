// Server only. Loads the agents of the active workspace plus the control room inputs (sessions, members, creators).
import type { RequestContext } from "@/lib/auth/context";
import { getStore } from "@/lib/store";
import type { Agent } from "@/lib/types";
import { loadDashboardInput, type DashboardInput } from "./load";

export type AgentsInput = DashboardInput & { agents: Agent[] };

export async function loadAgentsInput(ctx: RequestContext): Promise<AgentsInput> {
  const supabase = ctx.mode === "supabase" ? ctx.supabase : null;
  const store = supabase ? getStore({ supabase, workspaceId: ctx.workspaceId, userId: ctx.userId }) : getStore();
  const [agents, input] = await Promise.all([store.listAgents(), loadDashboardInput(ctx)]);
  return { ...input, agents };
}
