// Control room landing page after sign-in.
import { redirect } from "next/navigation";
import Dashboard from "@/components/dashboard/Dashboard";
import AppShell from "@/components/shell/AppShell";
import { getRequestContext } from "@/lib/auth/context";
import { loadDashboardInput } from "@/lib/dashboard/load";
import { buildDashboard } from "@/lib/dashboard/summary";

export const dynamic = "force-dynamic";

function Message({ text }: { text: string }) {
  return (
    <main className="flex flex-col gap-2 p-8">
      <h1 className="text-lg font-semibold">Dashboard</h1>
      <p>{text}</p>
    </main>
  );
}

export default async function DashboardPage() {
  return <AppShell>{await body()}</AppShell>;
}

async function body() {
  const result = await getRequestContext();
  if (result.kind === "signed_out") redirect("/login?next=/dashboard");
  if (result.kind === "misconfigured") return <Message text="Sign-in is not configured on this deployment." />;
  if (result.kind === "no_workspace") return <Message text="Your workspace could not be loaded. Try signing in again." />;
  const { ctx } = result;
  try {
    const input = await loadDashboardInput(ctx);
    return <Dashboard summary={buildDashboard(input.sessions, input.members, input.createdBy)} role={ctx.role} />;
  } catch (err) {
    console.error("dashboard:", err instanceof Error ? err.message : String(err));
    return <Message text="The dashboard could not be loaded. Try again." />;
  }
}
