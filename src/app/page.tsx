import Link from "next/link";
import { connection } from "next/server";
import { appMode } from "@/lib/supabase/env";

export default async function Home() {
  await connection();
  if (appMode() === "misconfigured") {
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
  return (
    <main className="flex flex-col gap-2 p-8">
      <h1 className="text-lg font-semibold">AI Apprentice</h1>
      <Link className="underline" href="/capture">
        Capture
      </Link>
      <Link className="underline" href="/map">
        Work Maps
      </Link>
      <Link className="underline" href="/teach">
        Teach
      </Link>
    </main>
  );
}
