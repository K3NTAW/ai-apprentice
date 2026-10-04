import Link from "next/link";
import { notFound } from "next/navigation";
import { memberName } from "@/components/agents/model";
import NewAgentFlow from "@/components/agents/NewAgentFlow";
import AppShell from "@/components/shell/AppShell";
import { previewWorkspace } from "@/lib/fixtures/workspace";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// Local mode only: the new agent flow with fixture data, for the side-by-side with NewAgent*.dc.html.
// ?step=2 shows steps 2 and 3 (avatar studio, install and train) for the fixture agent Pip.
export default async function NewAgentPreviewPage({ searchParams }: { searchParams: Promise<{ step?: string }> }) {
  if (appMode() !== "local") notFound();
  const later = (await searchParams).step === "2";
  const experts = previewWorkspace.members.filter((m) => m.role !== "learner").map((m) => ({ label: m.label, name: memberName(m.label) }));
  return (
    <AppShell>
      <main className="flex flex-col gap-7 px-4 pt-9 pb-14 sm:px-10">
        <div className="flex flex-col gap-1.5">
          <Link className="text-sm" href="/agents" style={{ color: "var(--mu)" }}>
            Agents /
          </Link>
          <h1 className="ui-t1">New agent</h1>
        </div>
        <NewAgentFlow
          initialAgentId={later ? "pip" : null}
          initialName="Pip"
          initialRole="Senior AP Clerk"
          initialExpert="Sabine Keller · sabine.keller@example.com"
          initialFirstTask="Coding incoming supplier invoices, including capex or opex and the second approval for the Czech subsidiary."
          experts={experts}
        />
      </main>
    </AppShell>
  );
}
