import TeachApp from "@/components/teach/TeachApp";
import { appMode } from "@/lib/supabase/env";

export const dynamic = "force-dynamic";

export default async function TeachPage({ searchParams }: { searchParams: Promise<{ session?: string | string[]; agent?: string | string[]; process?: string | string[] }> }) {
  const { session, agent, process } = await searchParams;
  return (
    <TeachApp
      sessionId={typeof session === "string" ? session : null}
      localMode={appMode() === "local"}
      agentParam={typeof agent === "string" ? agent : null}
      processId={typeof process === "string" ? process : null}
    />
  );
}
