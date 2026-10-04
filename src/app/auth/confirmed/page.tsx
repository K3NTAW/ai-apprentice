import LoginShell from "@/app/login/LoginShell";

// Sign-up confirmation landing (T-0163): /auth/callback?flow=signup sends the browser here when the confirmation
// link is opened outside the app (no session in this browser). Public route (proxy lets /auth/* through).
export default function ConfirmedPage() {
  return (
    <LoginShell>
      <div className="flex flex-col gap-2" data-screen="auth-confirmed">
        <h1 className="ui-t1">Email confirmed</h1>
        <p className="text-[15px]" style={{ color: "var(--mu)" }}>
          Confirmed. Go back to the AI Apprentice app and sign in.
        </p>
      </div>
    </LoginShell>
  );
}
