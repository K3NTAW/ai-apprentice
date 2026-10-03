"use client";

// Standalone sandbox page for manual checking: renders the ERP and logs emitted events.
import { useCallback, useState } from "react";
import ErpSandbox from "@/components/erp/ErpSandbox";
import type { ErpEvent, ErpMode } from "@/lib/erp/store";

export default function ErpPageClient({ mode }: { mode: ErpMode }) {
  const [log, setLog] = useState<{ n: number; at: string; e: ErpEvent }[]>([]);

  const onEvent = useCallback((e: ErpEvent) => {
    // TODO(T-0013): forward via emitDomEvent(e) from src/lib/perception/domEvents.ts once that module exists (owned by another task).
    setLog((l) => [{ n: l.length + 1, at: new Date().toLocaleTimeString("de-CH", { hour12: false }), e }, ...l]);
  }, []);

  return (
    <main className="flex gap-3 bg-slate-100 p-3">
      <div className="flex-1">
        <ErpSandbox key={mode} mode={mode} onEvent={onEvent} />
      </div>
      <aside className="w-72 shrink-0 border border-slate-300 bg-white p-2 text-xs">
        <div className="mb-1 font-semibold">Events ({mode})</div>
        <ol className="flex flex-col gap-1 font-mono">
          {log.map(({ n, at, e }) => (
            <li key={n} className="border-b border-slate-100 pb-1">
              {at} {e.type} {e.entity.id}
              {e.field ? ` ${e.field}` : ""}
              {e.from !== undefined || e.to !== undefined ? ` ${e.from ?? ""} -> ${e.to ?? ""}` : ""}
            </li>
          ))}
        </ol>
      </aside>
    </main>
  );
}
