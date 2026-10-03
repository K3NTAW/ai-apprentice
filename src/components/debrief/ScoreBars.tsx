"use client";

// Per-step score bars for the debrief: latest scores, animated as history grows, with the threshold line.
import { SCORE_THRESHOLD } from "@/lib/types";
import type { ScoreSnapshot } from "@/lib/debrief/controller";

function Bar({ label, value, first }: { label: string; value: number; first: number }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  const ok = value >= SCORE_THRESHOLD;
  const delta = Math.round((value - first) * 100);
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-16 text-slate-500">{label}</span>
      <div className="relative h-2.5 flex-1 rounded bg-slate-200">
        <div
          className={`h-2.5 rounded transition-all duration-700 ease-out ${ok ? "bg-green-500" : "bg-amber-400"}`}
          style={{ width: `${pct}%` }}
        />
        <div className="absolute top-[-3px] h-4 w-px bg-slate-600" style={{ left: `${SCORE_THRESHOLD * 100}%` }} />
      </div>
      <span className="w-20 text-right font-mono">
        {pct}%{delta > 0 && <span className="text-green-600"> +{delta}</span>}
      </span>
    </div>
  );
}

export default function ScoreBars({ history, titles }: { history: ScoreSnapshot[]; titles: Record<number, string> }) {
  const latest = history.at(-1);
  if (!latest) return null;
  const first = new Map(history[0].steps.map((s) => [s.n, s]));
  return (
    <section className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Understanding per step</h2>
        <span className="text-xs text-slate-500">
          round {history.length} · threshold {Math.round(SCORE_THRESHOLD * 100)}%
        </span>
      </div>
      {latest.steps.map((s) => (
        <div key={s.n} className="flex flex-col gap-1">
          <span className="text-xs font-medium text-slate-700">
            Step {s.n}
            {titles[s.n] ? `: ${titles[s.n]}` : ""}
          </span>
          <Bar label="reason" value={s.reason_captured} first={first.get(s.n)?.reason_captured ?? s.reason_captured} />
          <Bar
            label="guardrail"
            value={s.guardrail_captured}
            first={first.get(s.n)?.guardrail_captured ?? s.guardrail_captured}
          />
        </div>
      ))}
    </section>
  );
}
