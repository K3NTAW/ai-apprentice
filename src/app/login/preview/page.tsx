import { notFound } from "next/navigation";
import { appMode } from "@/lib/supabase/env";
import LoginForm from "../LoginForm";
import LoginShell from "../LoginShell";

export const dynamic = "force-dynamic";

const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}$/;

// Local mode only: the sign-in card, for the side-by-side with Login.dc.html (local mode skips /login).
// ?sent=<email> shows the link sent state (LoginSent.dc.html), which otherwise needs a real magic link.
export default async function LoginPreviewPage({ searchParams }: { searchParams?: Promise<{ sent?: string }> }) {
  if (appMode() !== "local") notFound();
  const sent = (await searchParams)?.sent;
  return (
    <LoginShell>
      <LoginForm next={null} initialSent={sent && EMAIL.test(sent) ? sent : undefined} />
    </LoginShell>
  );
}
