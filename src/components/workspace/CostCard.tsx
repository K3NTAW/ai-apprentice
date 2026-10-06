"use client";
// Cost of the active workspace per day (GET /api/workspace/cost, docs/checks/cost-meter.md). Plain table, no chart.
// CHF sums only priced rows; a kind with chf null shows "not priced", and unpriced events mark the total as partial.
import { useEffect, useState } from "react";
import type { CostResponse, CostRow } from "@/app/api/workspace/cost/cost";

type Load = { kind: "loading" } | { kind: "error" } | { kind: "ok"; data: CostResponse };

export type CostDay = {
  day: string;
  chf: number;
  tokens: number;
  voiceMinutes: number;
  frameMb: number;
  kinds: { kind: string; chf: number | null }[];
};

/** Rows of one day folded into one line; rows arrive newest first. */
export function costDays(rows: CostRow[]): CostDay[] {
  const days = new Map<string, CostDay>();
  for (const r of rows) {
    let d = days.get(r.day);
    if (!d) {
      d = { day: r.day, chf: 0, tokens: 0, voiceMinutes: 0, frameMb: 0, kinds: [] };
      days.set(r.day, d);
    }
    d.chf += r.chf ?? 0;
    d.tokens += (r.input_tokens ?? 0) + (r.output_tokens ?? 0) + (r.cache_read_tokens ?? 0);
    d.voiceMinutes += (r.voice_seconds ?? 0) / 60;
    if (r.kind === "frame") d.frameMb += (r.bytes ?? 0) / 1_000_000;
    d.kinds.push({ kind: r.kind, chf: r.chf });
  }
  return [...days.values()];
}

const muted = { color: "var(--mu)" } as const;

export default function CostCard() {
  const [load, setLoad] = useState<Load>({ kind: "loading" });

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const res = await fetch("/api/workspace/cost", { cache: "no-store" });
        const data = res.ok ? ((await res.json()) as CostResponse) : null;
        if (live) setLoad(data && Array.isArray(data.rows) ? { kind: "ok", data } : { kind: "error" });
      } catch {
        if (live) setLoad({ kind: "error" });
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (load.kind === "ok" && load.data.local) return null;

  return (
    <section aria-label="Cost" className="ui-card flex flex-col p-[22px]" style={{ gap: 12 }}>
      <h2 className="ui-t3">Cost</h2>
      {load.kind === "loading" && <p className="text-sm" style={muted}>Loading cost…</p>}
      {load.kind === "error" && <p className="text-sm" style={muted}>Cost could not be loaded.</p>}
      {load.kind === "ok" && <CostTable data={load.data} />}
    </section>
  );
}

function CostTable({ data }: { data: CostResponse }) {
  const days = costDays(data.rows);
  if (!days.length) return <p className="text-sm" style={muted}>No usage in the last {data.days} days</p>;
  const total = days.reduce((s, d) => s + d.chf, 0);
  const partial = data.rows.some((r) => r.unpriced_events > 0);
  return (
    <>
      <p className="text-sm">
        Total CHF {total.toFixed(2)}
        {partial && " (partial)"}
      </p>
      {partial && (
        <p className="text-[13px]" style={muted}>
          Some events have no price yet, so the total is lower than the real cost.
        </p>
      )}
      <table className="text-sm">
        <thead>
          <tr className="text-left" style={muted}>
            <th className="pr-4 font-normal">Day</th>
            <th className="pr-4 font-normal">CHF</th>
            <th className="pr-4 font-normal">Tokens</th>
            <th className="pr-4 font-normal">Voice min</th>
            <th className="pr-4 font-normal">Frames MB</th>
            <th className="font-normal">By kind</th>
          </tr>
        </thead>
        <tbody>
          {days.map((d) => (
            <tr key={d.day}>
              <td className="pr-4">{d.day}</td>
              <td className="pr-4">{d.chf.toFixed(2)}</td>
              <td className="pr-4">{d.tokens}</td>
              <td className="pr-4">{d.voiceMinutes.toFixed(1)}</td>
              <td className="pr-4">{d.frameMb.toFixed(2)}</td>
              <td>
                {d.kinds.map((k, i) => (
                  <span key={`${k.kind}-${i}`}>
                    {i > 0 && ", "}
                    {k.kind} {k.chf === null ? "not priced" : k.chf.toFixed(2)}
                  </span>
                ))}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {data.truncated && <p className="text-[13px]" style={muted}>showing the latest 500 rows</p>}
      <p className="text-[13px]" style={muted}>
        Voice is client-reported.
      </p>
    </>
  );
}
