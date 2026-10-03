// Agent gallery: the post-login home (/dashboard redirects here).
import { redirect } from "next/navigation";
import AgentGallery from "@/components/agents/AgentGallery";
import { galleryCards } from "@/components/agents/model";
import PageMessage from "@/components/agents/PageMessage";
import AppShell from "@/components/shell/AppShell";
import { canCapture } from "@/components/shell/ShellHeader";
import { getRequestContext } from "@/lib/auth/context";
import { loadAgentsInput } from "@/lib/dashboard/agents";

export const dynamic = "force-dynamic";

export default async function AgentsPage() {
  return <AppShell>{await body()}</AppShell>;
}

async function body() {
  const result = await getRequestContext();
  if (result.kind === "signed_out") redirect("/login?next=/agents");
  if (result.kind === "misconfigured") return <PageMessage title="Agents" text="Sign-in is not configured on this deployment." />;
  if (result.kind === "no_workspace") return <PageMessage title="Agents" text="Your workspace could not be loaded. Try signing in again." />;
  const { ctx } = result;
  try {
    const input = await loadAgentsInput(ctx);
    return <AgentGallery cards={galleryCards(input.agents, input.sessions)} canCreate={canCapture(ctx.role)} />;
  } catch (err) {
    console.error("agents:", err instanceof Error ? err.message : String(err));
    return <PageMessage title="Agents" text="The agents could not be loaded. Try again." />;
  }
}
