import { notFound } from "next/navigation";
import CapturePreview from "@/components/capture/CapturePreview";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// Local mode only: the Capture console with the fixture session, for the side-by-side with Capture.dc.html.
export default function CapturePreviewPage() {
  if (appMode() !== "local") notFound();
  return <CapturePreview />;
}
