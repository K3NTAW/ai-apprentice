import CaptureApp from "@/components/capture/CaptureApp";
import { canCapture } from "@/components/shell/ShellHeader";
import { getRequestContext } from "@/lib/auth/context";
import { parseTrainIntent } from "@/lib/processes/train";

export const dynamic = "force-dynamic";

export default async function CapturePage({ searchParams }: { searchParams: Promise<{ agent?: string | string[]; process?: string | string[]; mode?: string | string[] }> }) {
  const { agent, process, mode } = await searchParams;
  const result = await getRequestContext();
  if (result.kind === "ok" && !canCapture(result.ctx.role)) {
    return (
      <main className="flex flex-col gap-2 p-8">
        <h1 className="text-lg font-semibold">Capture</h1>
        <p className="text-sm text-muted">Capturing is for owners and experts. Open Teach to learn from the workspace&apos;s Work Maps.</p>
      </main>
    );
  }
  return <CaptureApp agentParam={typeof agent === "string" ? agent : null} intent={parseTrainIntent(process, mode)} />;
}
