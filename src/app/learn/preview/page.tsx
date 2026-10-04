import { notFound } from "next/navigation";
import LearnView from "@/components/agents/LearnView";
import { learnAgents, learnProcesses } from "@/components/agents/model";
import AppShell from "@/components/shell/AppShell";
import { previewAgents, previewSessions } from "@/lib/fixtures/agents";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// Local mode only: Learn with the fixture agents and Pip selected, for the side-by-side with Learn.dc.html.
export default function LearnPreviewPage() {
  if (appMode() !== "local") notFound();
  const agents = learnAgents(previewAgents, previewSessions);
  const selected = agents.find((a) => a.id === "pip") ?? null;
  return (
    <AppShell>
      <LearnView agents={agents} selected={selected} processes={selected ? learnProcesses(selected.id, previewSessions) : []} unknownAgent={false} />
    </AppShell>
  );
}
