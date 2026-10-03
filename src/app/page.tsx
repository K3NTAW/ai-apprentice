import Landing from "@/components/landing/Landing";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default function Home() {
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
  return <Landing mode={mode} />;
}
