// Work Map for one session. The Learners section is loaded here on the server through the request context.
import MapDetail from "@/components/map/MapDetail";
import { getRequestContext } from "@/lib/auth/context";
import { loadDashboardInput } from "@/lib/dashboard/load";
import { workmapLearners, type MasteryRow } from "@/lib/dashboard/summary";

export const dynamic = "force-dynamic";

async function learners(id: string): Promise<MasteryRow[] | null> {
  const result = await getRequestContext();
  if (result.kind !== "ok") return null;
  try {
    const input = await loadDashboardInput(result.ctx);
    return workmapLearners(id, input.sessions, input.members, input.createdBy);
  } catch (err) {
    console.error("map learners:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

export default async function MapPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <MapDetail id={id} learners={await learners(id)} />;
}
