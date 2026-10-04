import { notFound } from "next/navigation";
import ProcessEditor from "@/components/processes/ProcessEditor";
import AppShell from "@/components/shell/AppShell";
import { previewProcess, previewProcessVersions } from "@/lib/fixtures/processes";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// Local mode only: Pip's invoice Work Map as a process at version 2, as the owner sees it.
export default function ProcessPreviewPage() {
  if (appMode() !== "local") notFound();
  return (
    <AppShell>
      <ProcessEditor id={previewProcess.id} role="owner" editor="Preview" initial={{ process: previewProcess, versions: previewProcessVersions }} />
    </AppShell>
  );
}
