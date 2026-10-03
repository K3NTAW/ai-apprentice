"use client";

// Work Map session list: capture sessions, newest first.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Session } from "@/lib/types";
import { formatZurich } from "@/lib/workmap/view";

type Summary = { id: string; kind: Session["kind"]; started_at: string; expert?: string; has_workmap: boolean };
type Row = Summary & { confirmed: boolean | null };

export default function MapListPage() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/session", { cache: "no-store" });
        if (!res.ok) throw new Error(`GET /api/session ${res.status}`);
        const { sessions } = (await res.json()) as { sessions: Summary[] };
        const capture = sessions.filter((s) => s.kind === "capture");
        const out = await Promise.all(
          capture.map(async (s): Promise<Row> => {
            if (!s.has_workmap) return { ...s, confirmed: null };
            const r = await fetch(`/api/session/${encodeURIComponent(s.id)}`, { cache: "no-store" });
            const full = r.ok ? ((await r.json()) as Session) : null;
            return { ...s, confirmed: full?.workmap?.confirmed_by_expert ?? null };
          }),
        );
        if (!cancelled) setRows(out);
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex flex-col gap-4 p-8">
      <h1 className="text-lg font-semibold">Work Maps</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!rows && !error && <p className="text-sm text-slate-400">Loading…</p>}
      {rows && rows.length === 0 && <p className="text-sm text-slate-400">No capture sessions yet.</p>}
      {rows && rows.length > 0 && (
        <table className="text-left text-sm">
          <thead className="text-xs uppercase text-slate-500">
            <tr>
              <th className="py-1 pr-6">Started</th>
              <th className="py-1 pr-6">Expert</th>
              <th className="py-1 pr-6">Work Map</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-t border-slate-100">
                <td className="py-1 pr-6 font-mono">{formatZurich(r.started_at)}</td>
                <td className="py-1 pr-6">{r.expert ?? "unknown"}</td>
                <td className="py-1 pr-6">
                  {r.confirmed === true && <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">confirmed</span>}
                  {r.confirmed === false && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-xs text-slate-600">not yet confirmed</span>}
                  {r.confirmed === null && <span className="text-xs text-slate-400">not built</span>}
                </td>
                <td className="py-1">
                  <Link className="underline" href={`/map/${encodeURIComponent(r.id)}`}>
                    Open map
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
