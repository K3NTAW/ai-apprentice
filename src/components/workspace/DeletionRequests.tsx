"use client";
// Agent deletion requests on the Workspace page. Members see the list; the owner approves (runs the same delete as
// the agent's Delete button, src/lib/agents/admin.ts) or declines. Hidden when there are none.
import { useCallback, useEffect, useState } from "react";
import { Badge, Button, Card } from "@/components/ui";
import type { DeletionRequest } from "@/lib/agents/admin";

async function fetchRequests(): Promise<DeletionRequest[] | null> {
  try {
    const res = await fetch("/api/agents/deletion-requests", { cache: "no-store" });
    return res.ok ? ((await res.json()) as { requests: DeletionRequest[] }).requests : null;
  } catch {
    return null; // The list is optional on this page.
  }
}

export default function DeletionRequests({ owner }: { owner: boolean }) {
  const [requests, setRequests] = useState<DeletionRequest[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const next = await fetchRequests();
    if (next) setRequests(next);
  }, []);
  useEffect(() => {
    let live = true;
    void fetchRequests().then((next) => {
      if (live && next) setRequests(next);
    });
    return () => {
      live = false;
    };
  }, []);

  async function decide(id: string, status: "approved" | "declined") {
    setBusy(id);
    setNotice(null);
    try {
      const res = await fetch(`/api/agents/deletion-requests/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { message?: string };
        setNotice(b.message ?? `Could not save the decision (${res.status}).`);
      }
      await load();
    } catch {
      setNotice("Could not save the decision. Check the connection.");
    } finally {
      setBusy(null);
    }
  }

  const pending = requests.filter((r) => r.status === "pending");
  if (pending.length === 0 && !notice) return null;
  return (
    <section aria-label="Deletion requests" className="flex flex-col" style={{ gap: 12 }}>
      <h2 className="ui-t3">Deletion requests</h2>
      {pending.map((r) => (
        <Card key={r.id} className="flex flex-wrap items-center justify-between" style={{ padding: "14px 20px", gap: 12 }}>
          <span className="flex flex-col">
            <span>Delete {r.agent_name}</span>
            <span className="text-[13px]" style={{ color: "var(--mu)" }}>
              Requested {r.created_at.slice(0, 10)} <Badge kind="pending">Pending</Badge>
            </span>
          </span>
          {owner && (
            <span className="flex" style={{ gap: 8 }}>
              <Button variant="danger" size="sm" disabled={busy === r.id} onClick={() => void decide(r.id, "approved")}>
                Approve
              </Button>
              <Button variant="secondary" size="sm" disabled={busy === r.id} onClick={() => void decide(r.id, "declined")}>
                Decline
              </Button>
            </span>
          )}
        </Card>
      ))}
      {notice && (
        <p role="alert" className="text-sm" style={{ color: "var(--rd)" }}>
          {notice}
        </p>
      )}
    </section>
  );
}
