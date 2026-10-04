// Avatar studio for one agent. Loading the stored avatar arrives with the agents API; until then it starts from the default.
import Link from "next/link";
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
  return (
    <AppShell>
      <main className="flex flex-col gap-7 px-4 pt-9 pb-14 sm:px-10" data-screen="studio">
        <div className="flex flex-col gap-1.5">
          <Link className="text-sm" href={`/agents/${id}`} style={{ color: "var(--mu)" }}>
            Agent /
          </Link>
          <h1 className="ui-t1">Avatar studio</h1>
          <span className="text-sm" style={{ color: "var(--fa)" }}>Changes save to this agent only</span>
        </div>
        {result.kind === "ok" ? <AgentAvatarStudio agentId={id} /> : <p>Your workspace could not be loaded. Try signing in again.</p>}
      </main>
    </AppShell>
  );
}
