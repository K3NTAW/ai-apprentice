"use client";

// Processes tab, one process row (slice d): edit on the process page, the two training entry points (Capture with
// ?process&mode), archive and delete (owner, confirm first). Legacy session rows have no process and no actions.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { buttonClass } from "@/components/ui";
import type { Role } from "@/lib/auth/context";
import { confirmThen } from "@/lib/confirm";
import { deleteProcess, patchProcess } from "@/lib/processes/client";
import { ARCHIVE_PROCESS_CONFIRM, DELETE_PROCESS_CONFIRM, canArchiveProcess, canDeleteProcess, canEditProcess } from "@/lib/processes/edit";
import { trainHref } from "@/lib/processes/train";
import { processHref } from "./model";

export default function ProcessActions({ agentId, processId, role }: { agentId: string; processId: string; role: Role | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function act(message: string, action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      if ((await confirmThen(message, async () => (await action(), true))) !== null) router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center justify-end" style={{ gap: 8 }} data-testid="process-actions">
      <Link className={buttonClass("ghost", "sm")} href={processHref(processId)}>
        {canEditProcess(role) ? "Edit" : "Details"}
      </Link>
      {canEditProcess(role) && (
        <>
          <Link className={buttonClass("ghost", "sm")} href={trainHref(agentId, processId, "extend")}>
            Add to this process
          </Link>
          <Link className={buttonClass("ghost", "sm")} href={trainHref(agentId, processId, "replace")}>
            Retrain from scratch
          </Link>
        </>
      )}
      {canArchiveProcess(role) && (
        <button type="button" disabled={busy} className={buttonClass("ghost", "sm")} onClick={() => void act(ARCHIVE_PROCESS_CONFIRM, () => patchProcess(processId, { archived: true }))}>
          Archive
        </button>
      )}
      {canDeleteProcess(role) && (
        <button type="button" disabled={busy} className={buttonClass("danger", "sm")} onClick={() => void act(DELETE_PROCESS_CONFIRM, () => deleteProcess(processId))}>
          Delete
        </button>
      )}
      {error && (
        <span role="alert" className="text-[13px]" style={{ color: "var(--rd)" }}>
          {error}
        </span>
      )}
    </div>
  );
}
