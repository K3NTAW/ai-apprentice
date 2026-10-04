"use client";

// Work Map list: the workspace's capture sessions that have a Work Map, newest first.
import Link from "next/link";
import HoverPrefetchLink from "@/components/shell/HoverPrefetchLink";
import { useEffect, useState } from "react";
import { WORKMAPS_MAX_LIMIT, type WorkMapsResponse } from "@/lib/workmap/items";
import { mapListRows, type MapListRow } from "./list";

export default function MapListPage() {
  const [rows, setRows] = useState<MapListRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // One request for every map; no fetch per session.
        const res = await fetch(`/api/workmaps?limit=${WORKMAPS_MAX_LIMIT}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`GET /api/workmaps ${res.status}`);
        const { maps } = (await res.json()) as WorkMapsResponse;
        if (!cancelled) setRows(mapListRows(maps));
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
      {!rows && !error && <p className="text-sm text-muted">Loading…</p>}
      {rows && rows.length === 0 && (
        <p className="text-sm text-muted">
          No Work Maps yet.{" "}
          <Link className="underline" href="/capture">
            Capture a session
          </Link>{" "}
          to build the first one.
        </p>
      )}
      {rows && rows.length > 0 && (
        <ul className="flex flex-col divide-y divide-line text-sm">
          {rows.map((r) => (
            <li key={r.id}>
              <HoverPrefetchLink href={r.href} className="flex flex-col gap-1 py-2 hover:bg-panel-2 sm:flex-row sm:items-center sm:gap-4">
                <span className="font-medium">{r.expert}</span>
                <span className="font-mono text-muted">{r.date}</span>
                {r.confirmed && <span className="self-start rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">confirmed</span>}
                <span className="text-muted sm:ml-auto">{r.counts}</span>
              </HoverPrefetchLink>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
