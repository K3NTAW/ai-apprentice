"use client";

// Work Map for one session (canvas WorkMap.dc.html): build it if missing, header with counts and confirmation,
// export guardrails, open in Teach, the viewer (./WorkMapViewer) and its learners.
import Link from "next/link";
import { useEffect, useState } from "react";
import { Badge, buttonClass, Card } from "@/components/ui";
import { counts } from "@/lib/workmap/view";
import WorkMapViewer from "./WorkMapViewer";
import { MasteryLine } from "@/components/dashboard/Dashboard";
import type { MasteryRow } from "@/lib/dashboard/summary";
import type { Session, WorkMap } from "@/lib/types";

/** Learners section rows, loaded on the server; null when they could not be loaded. */
export function MapLearners({ rows }: { rows: MasteryRow[] | null }) {
  return (
    <section className="flex flex-col gap-2 text-sm">
      <h2 className="ui-t3">Learners</h2>
      {rows === null && <p className="text-muted">Learners could not be loaded.</p>}
      {rows?.length === 0 && (
        <p className="text-muted">
          Nobody has practised this Work Map yet. Open it in Teach, or{" "}
          <Link className="underline" href="/workspace">
            invite a learner
          </Link>
          .
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
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

/** previewSession: local preview route only (design compare); nothing is fetched. */
export default function MapDetail({ id, learners, previewSession }: { id: string; learners: MasteryRow[] | null; previewSession?: Session }) {
  const [session, setSession] = useState<Session | null>(previewSession ?? null);
  const [error, setError] = useState<string | null>(null);
  const [building, setBuilding] = useState(false);

  useEffect(() => {
    if (previewSession) return;
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
  }, [id, previewSession]);

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

  const wm = session?.workmap ?? null;
  const c = wm ? counts(wm) : null;
  return (
    <main className="flex min-w-0 flex-col" style={{ padding: "28px 40px 56px", gap: 22 }}>
      {error && <p role="alert" className="text-[13px]" style={{ color: "var(--rd)" }}>{error}</p>}
      {!session && !error && <p className="text-[13px]" style={{ color: "var(--fa)" }}>Loading…</p>}
      {session && !wm && (
        <div className="flex flex-col items-start" style={{ gap: 10 }}>
          <Link className="text-[13px] no-underline" style={{ color: "var(--mu)" }} href="/map">
            All Work Maps
          </Link>
          <p className="text-[13px]" style={{ color: "var(--mu)" }}>This session has no Work Map yet.</p>
          <button type="button" onClick={build} disabled={building} className={buttonClass("primary", "sm")}>
            {building ? "Building…" : "Build Work Map"}
          </button>
        </div>
      )}
      {session && wm && c && (
        <>
          <div className="flex flex-wrap items-end justify-between" style={{ gap: 16 }}>
            <div className="flex min-w-0 flex-col" style={{ gap: 8 }}>
              <Link className="text-[13px] no-underline" style={{ color: "var(--mu)" }} href="/map">
                All Work Maps / Work Map
              </Link>
              <h1 className="ui-t1">{wm.task}</h1>
              <div className="flex flex-wrap items-center" style={{ gap: 10 }}>
                <span className="ui-t3" style={{ fontWeight: 500 }}>
                  {c.steps} steps · <span style={{ color: "var(--am)" }}>{c.judgmentCalls} judgment calls</span> · {c.guardrails} guardrails
                </span>
                {wm.confirmed_by_expert ? <Badge kind="confirmed">Confirmed by {wm.expert}</Badge> : <Badge kind="pending" />}
              </div>
            </div>
            <div className="flex flex-wrap" style={{ gap: 8 }}>
              <a className={buttonClass("secondary")} href={`/api/export?session_id=${encodeURIComponent(session.id)}`} download={`guardrails-${session.id}.md`}>
                <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11M7 10l5 5 5-5M5 20h14" /></svg>
                Export guardrails
              </a>
              <Link className={buttonClass("primary")} href={`/teach?session=${encodeURIComponent(session.id)}`}>
                <svg className="ui-ic" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7.5 12 4l9 3.5-9 3.5z" /><path d="M7 9.5V15c0 1.5 2.5 3 5 3s5-1.5 5-3V9.5" /></svg>
                Open in Teach
              </Link>
            </div>
          </div>
          <WorkMapViewer sessionId={session.id} workmap={wm} />
          <Card style={{ padding: 22 }}>
            <MapLearners rows={learners} />
          </Card>
        </>
      )}
    </main>
  );
}
