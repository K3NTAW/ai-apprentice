import { notFound } from "next/navigation";
import ShellHeader, { type ShellUser } from "@/components/shell/ShellHeader";
import { Card } from "@/components/ui";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

// Local mode only (T-0257): the Supabase-mode sidebar (workspace menu, user menu with sign out) over a long page of
// cards, so the e2e can open both menus and the Create workspace dialog where the live run found them covered/clipped.
const user: ShellUser = {
  mode: "supabase",
  workspaceName: "Finance Ops",
  email: "sabine.keller@example.com",
  role: "owner",
  workspaceId: "11111111-1111-4111-8111-111111111111",
  memberships: [
    { workspaceId: "11111111-1111-4111-8111-111111111111", name: "Finance Ops", role: "owner", city: "Zug" },
    { workspaceId: "22222222-2222-4222-8222-222222222222", name: "Sales", role: "learner", city: null },
  ],
};

export default function ShellPreviewPage() {
  if (appMode() !== "local") notFound();
  return (
    <div className="flex min-h-screen flex-col md:flex-row" style={{ background: "var(--bg)", color: "var(--tx)" }}>
      <ShellHeader user={user} />
      <div className="min-w-0 flex-1">
        <main className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3" style={{ padding: "36px 40px 56px" }}>
          {Array.from({ length: 18 }, (_, i) => (
            <Card key={i} className="relative" style={{ height: 220, padding: 18, zIndex: 1 }}>
              Card {i + 1}
            </Card>
          ))}
        </main>
      </div>
    </div>
  );
}
