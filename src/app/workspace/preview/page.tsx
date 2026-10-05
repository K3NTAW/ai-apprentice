import { notFound } from "next/navigation";
import AppShell from "@/components/shell/AppShell";
import { previewWorkspace } from "@/lib/fixtures/workspace";
import { fixturesEnabled } from "@/lib/fixtures/enabled";
import WorkspaceClient from "../WorkspaceClient";

export const dynamic = "force-dynamic";

// Local mode only: the owner workspace view with fixture members, for the side-by-side with Workspace.dc.html.
export default function WorkspacePreviewPage() {
  if (!fixturesEnabled()) notFound();
  return (
    <AppShell>
      <WorkspaceClient view={previewWorkspace} />
    </AppShell>
  );
}
