import { notFound } from "next/navigation";
import DebriefApp from "@/components/debrief/DebriefApp";
import { previewAgents } from "@/lib/fixtures/agents";
import { previewDebriefSession, previewDebriefState, previewLiveAnswer } from "@/lib/fixtures/preview";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// Local mode only: a debrief in progress with fixture state, for the side-by-side with Debrief.dc.html.
// ?state=asking (default: follow-up question, live answer, understanding per step) or ?state=teach_back.
export default async function DebriefPreviewPage({ searchParams }: { searchParams: Promise<{ state?: string }> }) {
  if (appMode() !== "local") notFound();
  const state = (await searchParams).state === "teach_back" ? "teach_back" : "asking";
  return (
    <DebriefApp
      sessionId={previewDebriefSession.id}
      preview={{
        session: previewDebriefSession,
        view: previewDebriefState(state),
        liveAnswer: state === "asking" ? previewLiveAnswer : null,
        avatar: previewAgents.find((a) => a.id === "pip")!.avatar,
      }}
    />
  );
}
