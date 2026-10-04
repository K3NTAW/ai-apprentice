import { redirect } from "next/navigation";
import { getRequestContext } from "@/lib/auth/context";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// The app opens straight into the product; the marketing site is its own project (marketing/, docs/DEPLOY.md).
// Signed in (or local mode, which has no sign-in) goes to /agents, signed out to /login. A context that could not be
// resolved goes to /login with a notice, never to /agents: misconfigured -> the setup notice, any other kind or a thrown
// lookup (e.g. Supabase down) -> the 'unavailable' notice.
export default async function Home() {
  const mode = appMode();
  if (mode === "misconfigured") {
    return (
      <main className="flex max-w-xl flex-col gap-2 p-8">
        <h1 className="text-lg font-semibold">AI Apprentice</h1>
        <p>This deployment is not set up yet.</p>
        <p className="text-sm">
          Set NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY and SUPABASE_SERVICE_ROLE_KEY for this
          environment and redeploy. The steps are in docs/DEPLOY.md.
        </p>
      </main>
    );
  }
  if (mode === "local") redirect("/agents");
  let kind: string;
  try {
    kind = (await getRequestContext()).kind;
  } catch {
    kind = "error";
  }
  if (kind === "ok" || kind === "no_workspace") redirect("/agents");
  if (kind === "signed_out") redirect("/login");
  redirect(kind === "misconfigured" ? "/login?error=setup" : "/login?error=unavailable");
}
