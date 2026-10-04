// Learn: a new employee picks an agent with a confirmed process, then a process; Teach starts with ?agent&session.
import { redirect } from "next/navigation";
import LearnView from "@/components/agents/LearnView";
import { learnAgents, learnProcesses, learnTraining, parseId } from "@/components/agents/model";
import { memberName } from "@/components/agents/NewAgentFlow";
import PageMessage from "@/components/agents/PageMessage";
import AppShell from "@/components/shell/AppShell";
import { getRequestContext } from "@/lib/auth/context";
import { loadAgentsInput } from "@/lib/dashboard/agents";

export const dynamic = "force-dynamic";

export default async function LearnPage({ searchParams }: { searchParams: Promise<{ agent?: string | string[] }> }) {
  const { agent } = await searchParams;
  return <AppShell>{await body(parseId(agent))}</AppShell>;
}

async function body(agentId: string | null) {
  const result = await getRequestContext();
  if (result.kind === "signed_out") redirect("/login?next=/learn");
  if (result.kind !== "ok") return <PageMessage title="Learn" text="Your workspace could not be loaded. Try signing in again." />;
  try {
    const input = await loadAgentsInput(result.ctx);
    const agents = learnAgents(input.agents, input.sessions);
    const selected = agentId ? (agents.find((a) => a.id === agentId) ?? null) : null;
    return (
      <LearnView
        agents={agents}
        selected={selected}
        processes={selected ? learnProcesses(selected.id, input.sessions) : []}
        unknownAgent={agentId !== null && selected === null}
        training={learnTraining(input.agents, input.sessions)}
        firstName={result.ctx.email ? memberName(result.ctx.email).split(" ")[0] : null}
      />
    );
  } catch (err) {
    console.error("learn:", err instanceof Error ? err.message : String(err));
    return <PageMessage title="Learn" text="The agents could not be loaded. Try again." />;
  }
}
