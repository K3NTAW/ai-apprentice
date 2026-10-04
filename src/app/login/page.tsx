import { redirect } from "next/navigation";
import { loginErrorMessage, safeNext } from "@/lib/auth/redirect";
import { appMode } from "@/lib/supabase/env";
import LoginForm from "./LoginForm";
import LoginShell from "./LoginShell";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// Notices '/' sends here when the request context could not be resolved (src/app/page.tsx). Fixed texts only.
const SETUP_NOTICE = "Sign-in is not configured on this deployment.";
const NOTICES: Record<string, string> = {
  setup: `${SETUP_NOTICE} The steps are in docs/DEPLOY.md.`,
  unavailable: "Sign-in is unavailable right now. Try again in a moment.",
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const mode = appMode();
  if (mode === "local") redirect("/capture");
  const params = await searchParams;
  const error = first(params.error);
  if (mode !== "supabase") {
    return (
      <LoginShell>
        <h1 className="ui-t1">Sign in</h1>
        <p style={{ color: "var(--mu)" }}>{SETUP_NOTICE}</p>
      </LoginShell>
    );
  }

  // Only a given, safe next is passed on: the magic link falls back to /dashboard, the password login to /agents.
  const nextParam = first(params.next);
  const next = nextParam ? safeNext(nextParam) : null;
  const errorMessage = (error && Object.hasOwn(NOTICES, error) ? NOTICES[error] : null) ?? loginErrorMessage(error);

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
