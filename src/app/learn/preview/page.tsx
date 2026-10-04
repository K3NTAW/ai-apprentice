import { notFound } from "next/navigation";
import LearnView from "@/components/agents/LearnView";
import { learnAgents, learnProcesses, learnTraining } from "@/components/agents/model";
import AppShell from "@/components/shell/AppShell";
import { previewAgents } from "@/lib/fixtures/agents";
import { previewSessionsFull as previewSessions } from "@/lib/fixtures/preview";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// Local mode only: Learn with the fixture agents and Pip selected, for the side-by-side with Learn.dc.html.
export default function LearnPreviewPage() {
  if (appMode() !== "local") notFound();
  const agents = learnAgents(previewAgents, previewSessions);
  const selected = agents.find((a) => a.id === "pip") ?? null;
  return (
    <AppShell>
      <LearnView agents={agents} selected={selected} processes={selected ? learnProcesses(selected.id, previewSessions) : []} unknownAgent={false} training={learnTraining(previewAgents, previewSessions)} firstName="Lena" />
    </AppShell>
  );
}
