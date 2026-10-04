import { redirect } from "next/navigation";
import { loginErrorMessage, safeNext } from "@/lib/auth/redirect";
import { appMode } from "@/lib/supabase/env";
import LoginForm from "./LoginForm";
import LoginShell from "./LoginShell";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const mode = appMode();
  if (mode === "local") redirect("/capture");
  if (mode !== "supabase") {
    return (
      <LoginShell>
        <h1 className="ui-t1">Sign in</h1>
        <p style={{ color: "var(--mu)" }}>Sign-in is not configured on this deployment.</p>
      </LoginShell>
    );
  }

  const params = await searchParams;
  // Only a given, safe next is passed on: the magic link falls back to /dashboard, the code login to /agents.
  const nextParam = first(params.next);
  const next = nextParam ? safeNext(nextParam) : null;
  const errorMessage = loginErrorMessage(first(params.error));

  return (
    <LoginShell>
      {errorMessage && (
        <p role="alert" className="text-sm" style={{ color: "var(--rd)" }}>
          {errorMessage}
        </p>
      )}
      <LoginForm next={next} />
    </LoginShell>
  );
}
