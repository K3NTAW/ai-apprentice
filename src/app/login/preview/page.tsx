import { notFound } from "next/navigation";
import { appMode } from "@/lib/supabase/env";
import LoginForm from "../LoginForm";
import LoginShell from "../LoginShell";

export const dynamic = "force-dynamic";

// Local mode only: the sign-in card, for the side-by-side with Login.dc.html (local mode skips /login).
export default function LoginPreviewPage() {
  if (appMode() !== "local") notFound();
  return (
    <LoginShell>
      <LoginForm next={null} />
    </LoginShell>
  );
}
