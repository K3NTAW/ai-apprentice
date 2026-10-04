import { redirect } from "next/navigation";
import LoginShell from "@/app/login/LoginShell";
import { appMode } from "@/lib/supabase/env";
import ResetForm from "./ResetForm";

export const dynamic = "force-dynamic";

// Password reset (T-0160): the recovery email links here (redirectTo <origin>/auth/reset). Public route (proxy
// lets /auth/* through); the session comes from the link, not from a cookie.
export default function ResetPage() {
  const mode = appMode();
  if (mode === "local") redirect("/capture");
  return (
    <LoginShell>
      {mode === "supabase" ? (
        <ResetForm />
      ) : (
        <>
          <h1 className="ui-t1">Set a new password</h1>
          <p style={{ color: "var(--mu)" }}>Sign-in is not configured on this deployment.</p>
        </>
      )}
    </LoginShell>
  );
}
