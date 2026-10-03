"use client";

// Work Map for one session: build it if missing, view it, export guardrails, open in Teach, see its learners.
import Link from "next/link";
import { useEffect, useState } from "react";
import WorkMapView from "@/components/workmap/WorkMapView";
import { MasteryLine } from "@/components/dashboard/Dashboard";
import type { MasteryRow } from "@/lib/dashboard/summary";
import type { Session, WorkMap } from "@/lib/types";

/** Learners section rows, loaded on the server; null when they could not be loaded. */
export function MapLearners({ rows }: { rows: MasteryRow[] | null }) {
  return (
    <section className="flex flex-col gap-2 text-sm">
      <h2 className="font-semibold">Learners</h2>
      {rows === null && <p className="text-slate-500">Learners could not be loaded.</p>}
      {rows?.length === 0 && (
        <p className="text-slate-500">
          Nobody has practised this Work Map yet. Open it in Teach, or{" "}
          <Link className="underline" href="/workspace">
            invite a learner
          </Link>
          .
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-slate-100">
          {rows.map((r, i) => (
            <li key={`${r.learner}-${i}`} className="flex flex-col gap-0.5 py-1.5">
              <span className="font-medium">{r.learner}</span>
              <MasteryLine row={r} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default function MapDetail({ id, learners }: { id: string; learners: MasteryRow[] | null }) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/session/${encodeURIComponent(id)}`, { cache: "no-store" });
        if (!res.ok) throw new Error(res.status === 404 ? "Session not found." : `GET session ${res.status}`);
        const s = (await res.json()) as Session;
        if (!cancelled) setSession(s);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  const build = async () => {
    setBuilding(true);
    setError(null);
    try {
      const res = await fetch("/api/workmap", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: id }),
      });
      if (!res.ok) throw new Error(`POST /api/workmap ${res.status}`);
      const { workmap } = (await res.json()) as { workmap: WorkMap };
      setSession((s) => (s ? { ...s, workmap } : s));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBuilding(false);
    }
  };

  return (
    <main className="flex flex-col gap-4 p-8">
      <Link className="text-sm underline" href="/map">
        All Work Maps
      </Link>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!session && !error && <p className="text-sm text-slate-400">Loading…</p>}
      {session && !session.workmap && (
        <div className="flex flex-col items-start gap-2">
          <p className="text-sm text-slate-600">This session has no Work Map yet.</p>
          <button
            type="button"
            onClick={build}
            disabled={building}
            className="rounded bg-slate-900 px-3 py-1.5 text-sm text-white disabled:opacity-50"
          >
            {building ? "Building…" : "Build Work Map"}
          </button>
        </div>
      )}
      {session?.workmap && (
        <>
          <div className="flex gap-2">
            <a
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              href={`/api/export?session_id=${encodeURIComponent(session.id)}`}
              download={`guardrails-${session.id}.md`}
            >
              Export guardrails (.md)
            </a>
            <Link
              className="rounded border border-slate-300 px-3 py-1.5 text-sm hover:bg-slate-50"
              href={`/teach?session=${encodeURIComponent(session.id)}`}
            >
              Open in Teach
            </Link>
          </div>
          <WorkMapView sessionId={session.id} workmap={session.workmap} />
          <MapLearners rows={learners} />
        </>
      )}
    </main>
  );
}
