"use client";

// Understanding per step (canvas Debrief.dc.html, right card): one bar per step, the part held before the debrief
// faded and the part gained now solid, amber below the threshold, the 75% line, legend and the still-below note.
// A step's value is the lower of its two scores (reason and guardrail captured): it clears only when both do.
import { SCORE_THRESHOLD } from "@/lib/types";
import type { ScoreSnapshot } from "@/lib/debrief/controller";

const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100);
const stepValue = (s: { reason_captured: number; guardrail_captured: number }) => pct(Math.min(s.reason_captured, s.guardrail_captured));

export function StepBar({ n, title, was, now }: { n: number; title?: string; was: number; now: number }) {
  const threshold = Math.round(SCORE_THRESHOLD * 100);
  const v = Math.max(now, was);
  const lo = v < threshold ? "ui-lo" : undefined;
  const delta = v > was ? `+${v - was}` : "±0";
  return (
    <div className="flex flex-col" style={{ gap: 7 }} data-step={n}>
      <div className="flex items-baseline justify-between" style={{ gap: 10 }}>
        <span className="min-w-0 text-[13px]">
          <span className="ui-mono" style={{ color: "var(--fa)" }}>
            {n}
          </span>{" "}
          {title ?? `Step ${n}`}
        </span>
        <span className="ui-mono whitespace-nowrap text-[13px]">
          <span style={{ color: v > was ? "var(--gr)" : "var(--fa)" }}>{delta}</span> {v}%
        </span>
      </div>
      <div className="ui-bar" role="meter" aria-label={`Step ${n}`} aria-valuenow={v} aria-valuemin={0} aria-valuemax={100}>
        <i className={lo} style={{ width: `${v}%`, clipPath: `inset(0 0 0 ${v ? Math.round((was / v) * 100) : 0}%)`, transition: "width .7s ease-out" }} />
        <i className={lo} style={{ width: `${was}%`, opacity: 0.55 }} />
        <b style={{ left: `${threshold}%` }} />
      </div>
    </div>
  );
}

export default function ScoreBars({ history, titles }: { history: ScoreSnapshot[]; titles: Record<number, string> }) {
  const latest = history.at(-1);
  if (!latest) return null;
  const threshold = Math.round(SCORE_THRESHOLD * 100);
  const first = new Map(history[0].steps.map((s) => [s.n, s]));
  const below = latest.steps.filter((s) => stepValue(s) < threshold).length;
  const sw = (bg: string, opacity = 1) => <span style={{ width: 14, height: 6, borderRadius: 3, background: bg, opacity }} />;
  return (
    <section className="ui-card flex min-w-0 flex-col" style={{ padding: 24, gap: 18 }} data-testid="score-bars">
      <div className="flex flex-col" style={{ gap: 4 }}>
        <h2 className="ui-t3">Understanding per step</h2>
        <span className="text-[13px]" style={{ color: "var(--mu)" }}>
          Rises as you answer. The line marks {threshold}%, the bar to clear.
        </span>
      </div>
      <div className="flex flex-col" style={{ gap: 16 }}>
        {latest.steps.map((s) => {
          const f = first.get(s.n) ?? s;
          return <StepBar key={s.n} n={s.n} title={titles[s.n]} was={stepValue(f)} now={stepValue(s)} />;
        })}
      </div>
      <div className="flex flex-wrap text-xs" style={{ gap: 14, paddingTop: 14, borderTop: "1px solid var(--ln)", color: "var(--mu)" }}>
        <span className="inline-flex items-center" style={{ gap: 6 }}>
          {sw("var(--ac)", 0.55)}Before debrief
        </span>
        <span className="inline-flex items-center" style={{ gap: 6 }}>
          {sw("var(--ac)")}Gained now
        </span>
        <span className="inline-flex items-center" style={{ gap: 6 }}>
          {sw("var(--am)")}Below {threshold}%
        </span>
      </div>
      {below > 0 && (
        <span className="text-[13px]" style={{ padding: "12px 14px", borderRadius: 12, background: "var(--ams)", color: "var(--am)" }}>
          {below} {below === 1 ? "step" : "steps"} still below {threshold}%.
        </span>
      )}
    </section>
  );
}
