// Avatar studio for one agent. Loading the stored avatar arrives with the agents API; until then it starts from the default.
import { notFound, redirect } from "next/navigation";
import AgentAvatarStudio from "@/components/avatar/AgentAvatarStudio";
import AppShell from "@/components/shell/AppShell";
import { getRequestContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

const ID = /^[0-9a-zA-Z-]{1,64}$/;

export default async function AvatarStudioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!ID.test(id)) notFound();
  const result = await getRequestContext();
  if (result.kind === "signed_out") redirect(`/login?next=/agents/${id}/studio`);
  if (result.kind !== "ok")
    return (
      <AppShell>
        <main className="px-4 pt-9 sm:px-10" data-screen="studio">
          <p>Your workspace could not be loaded. Try signing in again.</p>
        </main>
      </AppShell>
    );
  // Studio.dc.html is a full-screen editor without the sidebar.
  return (
    <main className="min-h-screen" style={{ background: "var(--bg)" }} data-screen="studio">
      <AgentAvatarStudio agentId={id} />
    </main>
  );
}
