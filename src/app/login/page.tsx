import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import BrandMark from "@/components/landing/BrandMark";
import { buttonClass } from "@/components/ui";
import { loginErrorMessage, safeNext } from "@/lib/auth/redirect";
import { appMode } from "@/lib/supabase/env";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

/** Login.dc.html frame: brand, 'Back to the site' and the centred 440 px card. */
function LoginShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col" style={{ background: "var(--bg)" }}>
      <header className="flex flex-wrap items-center justify-between gap-4 px-8 py-[22px]">
        <Link href="/" className="flex items-center gap-2.5 text-base font-semibold" style={{ color: "var(--tx)" }}>
          <BrandMark />
          AI Apprentice
        </Link>
        <Link href="/" className={buttonClass("ghost", "md", "h-9")}>
          Back to the site
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-4 pt-8 pb-24">
        <div className="ui-card flex w-full max-w-[440px] flex-col gap-6 px-9 py-10" style={{ boxShadow: "var(--sh)" }}>
          {children}
        </div>
      </main>
    </div>
  );
}

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
