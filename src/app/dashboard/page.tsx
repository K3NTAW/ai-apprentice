// The post-login home moved to the agent gallery. Revert this file alone to restore the old dashboard.
import { redirect } from "next/navigation";

export default function DashboardPage() {
  redirect("/agents");
}
