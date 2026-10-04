import { notFound } from "next/navigation";
import AgentDetail from "@/components/agents/AgentDetail";
import { agentGuardrails, agentLearners, agentProcesses, agentShortcuts, parseTab } from "@/components/agents/model";
import AppShell from "@/components/shell/AppShell";
import { agentStats } from "@/lib/agents/stats";
import { previewAgents, previewCreatedBy, previewMembers } from "@/lib/fixtures/agents";
import { previewSessionsFull as previewSessions } from "@/lib/fixtures/preview";
import type { Process } from "@/lib/store/types";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string | string[] }> };

// Local mode only: one fixture agent page, for the side-by-side with Agent*.dc.html.
export default async function AgentPreviewPage({ params, searchParams }: Props) {
  if (appMode() !== "local") notFound();
  const { id } = await params;
  const agent = previewAgents.find((a) => a.id === id);
  if (!agent) notFound();
  const sessions = previewSessions;
  // The fixtures predate processes: every confirmed Work Map is a legacy session (agentWorkMaps).
  const processes: Process[] = [];
  return (
    <AppShell>
      <AgentDetail
        agent={agent}
        role="owner"
        tab={parseTab((await searchParams).tab)}
        stats={agentStats(id, sessions.map((s) => ({ ...s, created_by: previewCreatedBy[s.id] ?? null })), processes)}
        processes={agentProcesses(id, sessions, processes)}
        shortcuts={agentShortcuts(id, sessions, processes)}
        guardrails={agentGuardrails(id, sessions, processes)}
        learners={agentLearners(id, sessions, previewMembers, previewCreatedBy)}
      />
    </AppShell>
  );
}
