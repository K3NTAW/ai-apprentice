// Agent page: header, Train and Teach buttons, tabs (processes, shortcuts, guardrails, learners, settings).
import { notFound, redirect } from "next/navigation";
import AgentDetail from "@/components/agents/AgentDetail";
import { agentGuardrails, agentLearners, agentProcesses, agentShortcuts, parseId, parseTab } from "@/components/agents/model";
import PageMessage from "@/components/agents/PageMessage";
import AppShell from "@/components/shell/AppShell";
import { agentStats } from "@/lib/agents/stats";
import { getRequestContext } from "@/lib/auth/context";
import { loadAgentsInput } from "@/lib/dashboard/agents";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string | string[] }> };

export default async function AgentPage({ params, searchParams }: Props) {
  const { id: raw } = await params;
  const id = parseId(raw);
  if (!id) notFound();
  const { tab } = await searchParams;
  return <AppShell>{await body(id, parseTab(tab))}</AppShell>;
}

async function body(id: string, tab: ReturnType<typeof parseTab>) {
  const result = await getRequestContext();
  if (result.kind === "signed_out") redirect(`/login?next=/agents/${id}`);
  if (result.kind !== "ok") return <PageMessage title="Agent" text="Your workspace could not be loaded. Try signing in again." />;
  const { ctx } = result;
  let input;
  try {
    input = await loadAgentsInput(ctx);
  } catch (err) {
    console.error("agent:", err instanceof Error ? err.message : String(err));
    return <PageMessage title="Agent" text="The agent could not be loaded. Try again." />;
  }
  const agent = input.agents.find((a) => a.id === id);
  if (!agent) notFound();
  const { sessions, processes } = input;
  return (
    <AgentDetail
      agent={agent}
      role={ctx.role}
      tab={tab}
      stats={agentStats(id, sessions.map((s) => ({ ...s, created_by: input.createdBy[s.id] ?? null })), processes)}
      processes={agentProcesses(id, sessions, processes)}
      shortcuts={agentShortcuts(id, sessions, processes)}
      guardrails={agentGuardrails(id, sessions, processes)}
      learners={agentLearners(id, sessions, input.members, input.createdBy)}
    />
  );
}
