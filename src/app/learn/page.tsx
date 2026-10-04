// Learn: a new employee picks an agent with a confirmed process, then a process; Teach starts with ?agent&session.
// Processes come from agentWorkMaps (processes merged with legacy confirmed sessions); a process opens Teach with
// its newest linked capture session.
// Processes of every offered agent load with the page, so picking an agent switches client-side.
import { redirect } from "next/navigation";
import LearnView from "@/components/agents/LearnView";
import { learnAgents, learnProcesses, learnTraining, memberName, parseId } from "@/components/agents/model";
import PageMessage from "@/components/agents/PageMessage";
import AppShell from "@/components/shell/AppShell";
import { getRequestContext } from "@/lib/auth/context";
import { loadAgentProcesses, loadAgentsInput } from "@/lib/dashboard/agents";

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
    const [input, processes] = await Promise.all([loadAgentsInput(result.ctx), loadAgentProcesses(result.ctx)]);
    const agents = learnAgents(input.agents, input.sessions, processes);
    const selected = agentId ? (agents.find((a) => a.id === agentId) ?? null) : null;
    return (
      <LearnView
        agents={agents}
        selected={selected}
        processes={selected ? learnProcesses(selected.id, input.sessions, processes) : []}
        processesByAgent={Object.fromEntries(agents.map((a) => [a.id, learnProcesses(a.id, input.sessions, processes)]))}
        unknownAgent={agentId !== null && selected === null}
        training={learnTraining(input.agents, input.sessions, processes)}
        firstName={result.ctx.email ? memberName(result.ctx.email).split(" ")[0] : null}
      />
    );
  } catch (err) {
    console.error("learn:", err instanceof Error ? err.message : String(err));
    return <PageMessage title="Learn" text="The agents could not be loaded. Try again." />;
  }
}
