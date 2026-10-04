// Process page (processes slice d): edit and manage one process. Data is loaded in the browser from /api/processes
// (503 before the migration: the page says so).
import { notFound, redirect } from "next/navigation";
import { parseId } from "@/components/agents/model";
import PageMessage from "@/components/agents/PageMessage";
import ProcessEditor from "@/components/processes/ProcessEditor";
import AppShell from "@/components/shell/AppShell";
import { getRequestContext } from "@/lib/auth/context";

export const dynamic = "force-dynamic";

export default async function ProcessPage({ params }: { params: Promise<{ id: string }> }) {
  const id = parseId((await params).id);
  if (!id) notFound();
  const result = await getRequestContext();
  if (result.kind === "signed_out") redirect(`/login?next=/processes/${id}`);
  if (result.kind !== "ok")
    return (
      <AppShell>
        <PageMessage title="Process" text="Your workspace could not be loaded. Try signing in again." />
      </AppShell>
    );
  const { ctx } = result;
  return (
    <AppShell>
      <ProcessEditor id={id} role={ctx.role} editor={ctx.fullName?.trim() || ctx.email || "someone"} />
    </AppShell>
  );
}
