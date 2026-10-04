// First sign-in onboarding (T-0211): workspace, desktop permissions, first agent, how training works.
// Reached from the sign-in redirect (auth callback, password bootstrap) and from 'Finish setup' in the user menu.
// No AppShell here and no redirect of its own, so it can never loop. Signed out: /login?next=/onboarding.
import { redirect } from "next/navigation";
import OnboardingFlow from "@/components/onboarding/OnboardingFlow";
import { canCapture } from "@/components/shell/ShellHeader";
import { getRequestContext } from "@/lib/auth/context";
import { safeNext } from "@/lib/auth/redirect";
import { readLocalOnboarding } from "@/lib/onboarding/file";
import { emptyState, isStep } from "@/lib/onboarding/state";
import { loadExpertOptions } from "../agents/new/experts";

export const dynamic = "force-dynamic";

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string; step?: string }> }) {
  const sp = await searchParams;
  const result = await getRequestContext();
  if (result.kind === "signed_out") redirect("/login?next=/onboarding");
  if (result.kind !== "ok")
    return (
      <main className="mx-auto flex max-w-[640px] flex-col gap-2 px-4 pt-16">
        <h1 className="ui-t1">Set up AI Apprentice</h1>
        <p style={{ color: "var(--mu)" }}>Your workspace could not be loaded. Try signing in again.</p>
      </main>
    );
  const { ctx } = result;
  const state = ctx.mode === "local" ? await readLocalOnboarding() : (ctx.onboarding ?? emptyState());
  const active = ctx.memberships.find((m) => m.workspaceId === ctx.workspaceId);
  // Invite case: bootstrap_workspace accepts pending invites and only creates a personal (owner) workspace when
  // there were none, so a membership with another role means the user joined through an invite.
  const joined = ctx.memberships.find((m) => m.role !== "owner") ?? null;
  const agentsAllowed = canCapture(ctx.role);
  return (
    <OnboardingFlow
      initial={state}
      mode={ctx.mode}
      workspace={{ name: active?.name ?? ctx.workspaceName, city: active?.city ?? null, role: ctx.role }}
      joined={joined ? { name: joined.name, role: joined.role } : null}
      canCreateAgents={agentsAllowed}
      experts={agentsAllowed ? await loadExpertOptions(ctx) : []}
      next={safeNext(sp.next ?? null, "/agents")}
      startStep={isStep(sp.step) ? sp.step : undefined}
    />
  );
}
