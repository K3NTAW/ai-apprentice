import { notFound } from "next/navigation";
import CapturePreview from "@/components/capture/CapturePreview";
import { fixturesEnabled } from "@/lib/fixtures/enabled";

export const dynamic = "force-dynamic";

// Local mode only: the Capture console with the fixture session, for the side-by-side with Capture.dc.html.
export default function CapturePreviewPage() {
  if (!fixturesEnabled()) notFound();
  return <CapturePreview />;
}
