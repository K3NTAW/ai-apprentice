import { notFound } from "next/navigation";
import MapDetail from "@/components/map/MapDetail";
import { previewSessionsFull } from "@/lib/fixtures/preview";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// Local mode only: Pip's confirmed invoice Work Map from fixtures, for the side-by-side with WorkMap.dc.html
// (add ?theme=light for WorkMapLight.dc.html).
export default function MapPreviewPage() {
  if (appMode() !== "local") notFound();
  const session = previewSessionsFull.find((s) => s.id === "pip-1")!;
  return <MapDetail id={session.id} learners={[]} previewSession={session} />;
}
