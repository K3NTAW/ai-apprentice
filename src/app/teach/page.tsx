import TeachApp from "@/components/teach/TeachApp";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function TeachPage({ searchParams }: { searchParams: Promise<{ session?: string | string[] }> }) {
  const { session } = await searchParams;
  return <TeachApp sessionId={typeof session === "string" ? session : null} localMode={appMode() === "local"} />;
}
