"use client";

// Work Map list: the workspace's capture sessions that have a Work Map, newest first.
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Session } from "@/lib/types";
import { mapListRows, type MapListRow } from "./list";

type Summary = { id: string; kind: Session["kind"]; has_workmap: boolean };

export default function MapListPage() {
  const [rows, setRows] = useState<MapListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/session", { cache: "no-store" });
        if (!res.ok) throw new Error(`GET /api/session ${res.status}`);
        const { sessions } = (await res.json()) as { sessions: Summary[] };
        const full = await Promise.all(
          sessions
            .filter((s) => s.kind === "capture" && s.has_workmap)
            .map(async (s) => {
              const r = await fetch(`/api/session/${encodeURIComponent(s.id)}`, { cache: "no-store" });
              return r.ok ? ((await r.json()) as Session) : null;
            }),
        );
        if (!cancelled) setRows(mapListRows(full.filter((s): s is Session => s !== null)));
      } catch (err) {
        if (!cancelled) setError(String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="flex flex-col gap-4 p-4 sm:p-8">
      <h1 className="text-lg font-semibold">Work Maps</h1>
      {error && <p className="text-sm text-red-600">{error}</p>}
      {!rows && !error && <p className="text-sm text-slate-400">Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="text-sm text-slate-500">
          No Work Maps yet.{" "}
          <Link className="underline" href="/capture">
            Capture a session
          </Link>{" "}
          to build the first one.
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-slate-100 text-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <Link href={r.href} className="flex flex-col gap-1 py-2 hover:bg-slate-50 sm:flex-row sm:items-center sm:gap-4">
                <span className="font-medium">{r.expert}</span>
                <span className="font-mono text-slate-500">{r.date}</span>
                {r.confirmed && <span className="self-start rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">confirmed</span>}
                <span className="text-slate-600 sm:ml-auto">{r.counts}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
