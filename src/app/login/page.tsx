import { redirect } from "next/navigation";
import { loginErrorMessage, safeNext } from "@/lib/auth/redirect";
import { appMode } from "@/lib/supabase/env";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const mode = appMode();
  if (mode === "local") redirect("/capture");
  if (mode !== "supabase") {
    return (
      <main className="flex flex-col gap-2 p-8">
        <h1 className="text-lg font-semibold">Sign in</h1>
        <p>Sign-in is not configured on this deployment.</p>
      </main>
    );
  }

  const params = await searchParams;
  // Only a given, safe next is passed on: the magic link falls back to /dashboard, the code login to /agents.
  const nextParam = first(params.next);
  const next = nextParam ? safeNext(nextParam) : null;
  const errorMessage = loginErrorMessage(first(params.error));

  return (
    <main className="flex max-w-md flex-col gap-4 p-8">
      <h1 className="text-lg font-semibold">Sign in</h1>
      {errorMessage && (
        <p role="alert" className="text-red-700">
          {errorMessage}
        </p>
      )}
      <LoginForm next={next} />
    </main>
  );
}
