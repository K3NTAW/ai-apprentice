import { notFound } from "next/navigation";
import TeachPreview from "@/components/teach/TeachPreview";
import { fixturesEnabled } from "@/lib/fixtures/enabled";

export const dynamic = "force-dynamic";

// Local mode only: a live Teach session with fixture state (step progress, watching chips, transcript, replay card),
// for the side-by-side with Teach.dc.html.
export default function TeachPreviewPage() {
  if (!fixturesEnabled()) notFound();
  return <TeachPreview />;
}
