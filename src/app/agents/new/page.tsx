// Create agent flow: details, avatar studio, then Start training (Capture with ?agent=<id>).
import { redirect } from "next/navigation";
import NewAgentFlow from "@/components/agents/NewAgentFlow";
import PageMessage from "@/components/agents/PageMessage";
import AppShell from "@/components/shell/AppShell";
import { canCapture } from "@/components/shell/ShellHeader";
import { getRequestContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

export default async function NewAgentPage() {
  const result = await getRequestContext();
  if (result.kind === "signed_out") redirect("/login?next=/agents/new");
  if (result.kind !== "ok") return <AppShell><PageMessage title="New agent" text="Your workspace could not be loaded. Try signing in again." /></AppShell>;
  if (!canCapture(result.ctx.role)) return <AppShell><PageMessage title="New agent" text="Only owners and experts create agents." /></AppShell>;
  return (
    <AppShell>
      <main className="flex flex-col gap-4 p-4 sm:p-8">
        <h1 className="text-xl font-semibold tracking-tight">New agent</h1>
        <NewAgentFlow />
      </main>
    </AppShell>
  );
}
