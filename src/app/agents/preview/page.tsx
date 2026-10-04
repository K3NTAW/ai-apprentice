import { notFound } from "next/navigation";
import AgentsHome from "@/components/agents/AgentsHome";
import { galleryCards } from "@/components/agents/model";
import AppShell from "@/components/shell/AppShell";
import { homeIndex } from "@/lib/agents/home";
import { previewAgents, previewSessions } from "@/lib/fixtures/agents";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// Local mode only: the agents home with the fixture agents, for the side-by-side with Gallery.dc.html.
// ?empty=1 shows the empty state (GalleryEmpty.dc.html).
export default async function AgentsPreviewPage({ searchParams }: { searchParams: Promise<{ empty?: string }> }) {
  if (appMode() !== "local") notFound();
  const empty = (await searchParams).empty === "1";
  const agents = empty ? [] : previewAgents;
  return (
    <AppShell>
      <AgentsHome
        greeting="Good afternoon, Sabine"
        cards={galleryCards(agents, previewSessions)}
        canCreate
        index={homeIndex(agents, previewSessions)}
      />
    </AppShell>
  );
}
