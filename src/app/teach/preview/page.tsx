import { notFound } from "next/navigation";
import TeachPreview from "@/components/teach/TeachPreview";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// Local mode only: a live Teach session with fixture state (step progress, watching chips, transcript, replay card),
// for the side-by-side with Teach.dc.html.
export default function TeachPreviewPage() {
  if (appMode() !== "local") notFound();
  return <TeachPreview />;
}
