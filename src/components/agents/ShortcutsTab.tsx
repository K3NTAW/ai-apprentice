"use client";
// Shortcuts tab body (Agent.dc.html show.shortcuts): intro, per-app filter chips, the chord table.
import { useState } from "react";
import { Card, Chord } from "@/components/ui";
import type { ShortcutRow } from "./model";

const COLS = "150px 100px 190px minmax(0, 1fr)";
const quoteStyle = { fontFamily: "var(--font-serif)", fontStyle: "italic" as const, fontSize: 17, lineHeight: 1.3 };

/** Apps in first-seen order with their shortcut counts. */
export function shortcutApps(rows: readonly ShortcutRow[]): { app: string; n: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) if (r.app) counts.set(r.app, (counts.get(r.app) ?? 0) + 1);
  return [...counts].map(([app, n]) => ({ app, n }));
}

export default function ShortcutsTab({ rows, expert }: { rows: ShortcutRow[]; expert: string }) {
  const [app, setApp] = useState<string | null>(null);
  const shown = app ? rows.filter((r) => r.app === app) : rows;
  const chip = (label: string, value: string | null) => (
    <button
      key={label}
      type="button"
      aria-pressed={app === value}
      onClick={() => setApp(value)}
      className={`ui-bdg ${app === value ? "ui-k-ac" : "ui-k-pend"}`}
      style={{ cursor: "pointer" }}
    >
      {label}
    </button>
  );
  return (
    <>
      <div className="flex flex-wrap items-center justify-between" style={{ gap: 12 }}>
        <span style={{ color: "var(--mu)" }}>Shortcuts {expert} used while training, with why they use them. Learners see these as hints.</span>
        <div className="flex flex-wrap" style={{ gap: 8 }} role="group" aria-label="Filter by app">
          {chip("All apps", null)}
          {shortcutApps(rows).map((a) => chip(`${a.app} ${a.n}`, a.app))}
        </div>
      </div>
      <Card style={{ overflowX: "auto" }}>
        <div role="table" aria-label="Shortcuts" style={{ minWidth: 760 }}>
          <div role="row" className="grid text-xs" style={{ gridTemplateColumns: COLS, gap: 16, padding: "12px 20px", borderBottom: "1px solid var(--ln)", fontWeight: 500, color: "var(--fa)" }}>
            <span role="columnheader">Chord</span>
            <span role="columnheader">App</span>
            <span role="columnheader">What it does</span>
            <span role="columnheader">Why, in {expert}&apos;s words</span>
          </div>
          {shown.map((s) => (
            <div key={`${s.chord}|${s.app}`} role="row" className="grid items-center" style={{ gridTemplateColumns: COLS, gap: 16, padding: "14px 20px", borderBottom: "1px solid var(--ln)" }}>
              <span role="cell">
                {/* keycaps for the eye, "Cmd+Shift+T" for screen readers and page search */}
                <span className="sr-only">{s.chord.split(/[+\s]+/).filter(Boolean).join("+")}</span>
                <span aria-hidden="true">
                  <Chord keys={s.chord.split(/[+\s]+/).filter(Boolean)} />
                </span>
              </span>
              <span role="cell" style={{ color: "var(--mu)" }}>
                {s.app}
              </span>
              <span role="cell">{s.what}</span>
              <span role="cell">{s.why && <span style={quoteStyle}>{s.why}</span>}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
