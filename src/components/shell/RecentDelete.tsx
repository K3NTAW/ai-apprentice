"use client";
// Delete on a 'No work recorded' entry of the recent list (lib/capture/empty): asks first, then
// DELETE /api/session/<id> (creator or owner, empty runs only) and refreshes the list. Leaves the page when it shows the run.
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

export const RECENT_DELETE_CONFIRM = "Delete this run? No work was recorded in it. This cannot be undone.";

export default function RecentDelete({ id }: { id: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  async function onDelete() {
    if (busy || !window.confirm(RECENT_DELETE_CONFIRM)) return;
    setBusy(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/session/${encodeURIComponent(id)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404) throw new Error(`DELETE session ${res.status}`);
      if (pathname?.includes(`/${encodeURIComponent(id)}`)) router.push("/");
      router.refresh();
    } catch {
      setFailed(true);
      setBusy(false);
    }
  }

  return (
    <button
      type="button"
      onClick={onDelete}
      disabled={busy}
      aria-label="Delete run"
      title={failed ? "Delete failed, try again" : "Delete run"}
      className="ui-rb shrink-0 text-xs"
      style={{ color: failed ? "var(--rd)" : "var(--fa)", padding: "4px 8px" }}
    >
      {busy ? "…" : "Delete"}
    </button>
  );
}
