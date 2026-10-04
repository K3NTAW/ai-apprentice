"use client";

// Work Map viewer (BUILD_SPEC Module 2 output): header, clickable timeline, step list, step card.
import { useState } from "react";
import { SCORE_THRESHOLD, type WorkMap, type WorkMapStep } from "@/lib/types";
import { countsLine, formatT, guardrailKindLabel } from "@/lib/workmap/view";
import { ExpertQuote, StepFrame } from "./StepMoment";

export type WorkMapViewProps = {
  sessionId: string;
  workmap: WorkMap;
  onSelectStep?: (n: number) => void;
  compact?: boolean;
};

const KIND_BADGE: Record<WorkMapStep["guardrails"][number]["kind"], string> = {
  limit: "bg-blue-100 text-blue-800",
  exception: "bg-purple-100 text-purple-800",
  stop_and_ask: "bg-red-100 text-red-800",
};

function ScoreBar({ label, value }: { label: string; value: number }) {
  const ok = value >= SCORE_THRESHOLD;
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-xs text-muted">
        <span>{label}</span>
        <span className="font-mono">{pct}%</span>
      </div>
      <div className="relative h-2 w-full rounded bg-panel-2" title={`threshold ${Math.round(SCORE_THRESHOLD * 100)}%`}>
        <div className={`h-2 rounded ${ok ? "bg-green-500" : "bg-amber-400"}`} style={{ width: `${pct}%` }} />
        <div className="absolute top-[-2px] h-3 w-px bg-slate-500" style={{ left: `${SCORE_THRESHOLD * 100}%` }} />
      </div>
    </div>
  );
}

function Timeline({ steps, selected, onSelect }: { steps: WorkMapStep[]; selected: number; onSelect(n: number): void }) {
  const ts = steps.map((s) => s.screen_moment.t);
  const min = Math.min(...ts, 0);
  const max = Math.max(...ts, min + 1);
  const pos = (t: number) => ((t - min) / (max - min)) * 100;
  return (
    <div className="relative mx-3 my-4 h-8" role="list" aria-label="timeline">
      <div className="absolute left-0 right-0 top-1/2 h-px bg-line" />
      {steps.map((s) => {
        const active = s.n === selected;
        return (
          <button
            key={s.n}
            type="button"
            role="listitem"
            onClick={() => onSelect(s.n)}
            title={`Step ${s.n} at ${formatT(s.screen_moment.t)}: ${s.title}`}
            className={`absolute top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${
              s.is_judgment_call ? "h-4 w-4 border-amber-500" : "h-3 w-3 border-slate-500"
            } ${active ? "bg-slate-900" : s.is_judgment_call ? "bg-amber-200" : "bg-panel"}`}
            style={{ left: `${pos(s.screen_moment.t)}%` }}
            aria-label={`Step ${s.n}`}
          />
        );
      })}
    </div>
  );
}

function StepCard({ sessionId, workmap, step, compact }: { sessionId: string; workmap: WorkMap; step: WorkMapStep; compact?: boolean }) {
  const m = step.screen_moment;
  return (
    <article className="flex flex-col gap-3 rounded border border-line p-4">
      <h3 className="font-semibold">
        Step {step.n} of {workmap.steps.length}: {step.title}
        {step.is_judgment_call && (
          <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs font-normal text-amber-800">judgment call</span>
        )}
      </h3>
      <section className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase text-muted">Screen moment</h4>
        <p className="text-sm">
          <span className="font-mono">{formatT(m.t)}</span>, {m.entity}
          {m.field ? `, ${m.field} field` : ""}
        </p>
        <StepFrame sessionId={sessionId} frameRef={m.frame_ref} compact={compact} />
      </section>
      <section className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase text-muted">Decision</h4>
        <p className="text-sm">{step.decision}</p>
      </section>
      <section className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase text-muted">Reason</h4>
        <ExpertQuote expert={workmap.expert} reason={step.reason} />
      </section>
      <section className="flex flex-col gap-1">
        <h4 className="text-xs font-semibold uppercase text-muted">Guardrails</h4>
        {step.guardrails.length === 0 ? (
          <p className="text-sm text-muted">none captured</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {step.guardrails.map((g, i) => (
              <li key={i} className="text-sm">
                <span className={`mr-2 rounded px-1.5 py-0.5 text-xs ${KIND_BADGE[g.kind]}`}>{guardrailKindLabel(g.kind)}</span>
                {g.rule}
                <p className="mt-1 text-xs text-muted">
                  {g.quote ? <>&ldquo;{g.quote}&rdquo; </> : <span className="text-amber-700">quote not captured </span>}
                  at <span className="font-mono">{formatT(g.quote_ref)}</span>
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="grid grid-cols-2 gap-4">
        <ScoreBar label="Reason captured" value={step.scores.reason_captured} />
        <ScoreBar label="Guardrail captured" value={step.scores.guardrail_captured} />
      </section>
    </article>
  );
}

export default function WorkMapView({ sessionId, workmap, onSelectStep, compact }: WorkMapViewProps) {
  const [selected, setSelected] = useState<number>(workmap.steps[0]?.n ?? 0);
  const step = workmap.steps.find((s) => s.n === selected) ?? workmap.steps[0];
  const select = (n: number) => {
    setSelected(n);
    onSelectStep?.(n);
  };

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold">{workmap.task}</h2>
          {workmap.confirmed_by_expert ? (
            <span className="rounded bg-green-100 px-1.5 py-0.5 text-xs text-green-800">confirmed</span>
          ) : (
            <span className="rounded bg-panel-2 px-1.5 py-0.5 text-xs text-muted">not yet confirmed</span>
          )}
        </div>
        <p className="text-sm text-muted">Expert: {workmap.expert}</p>
        <p className="text-sm text-muted">{countsLine(workmap)}</p>
      </header>

      {workmap.steps.length === 0 ? (
        <p className="text-sm text-muted">No steps yet.</p>
      ) : (
        <>
          <Timeline steps={workmap.steps} selected={step.n} onSelect={select} />
          <div className={compact ? "flex flex-col gap-4" : "grid grid-cols-[16rem_1fr] gap-4"}>
            <ol className="flex flex-col gap-1">
              {workmap.steps.map((s) => (
                <li key={s.n}>
                  <button
                    type="button"
                    onClick={() => select(s.n)}
                    className={`w-full rounded px-2 py-1 text-left text-sm ${s.n === step.n ? "bg-slate-900 text-white" : "hover:bg-panel-2"}`}
                  >
                    <span className="mr-2 font-mono text-xs">{formatT(s.screen_moment.t)}</span>
                    {s.n}. {s.title}
                    {s.is_judgment_call && <span className="ml-1 text-amber-500" aria-label="judgment call">●</span>}
                  </button>
                </li>
              ))}
            </ol>
            <StepCard sessionId={sessionId} workmap={workmap} step={step} compact={compact} />
          </div>
        </>
      )}

      <section className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">Open questions</h3>
        {workmap.open_questions.length === 0 ? (
          <p className="text-sm text-muted">none</p>
        ) : (
          <ul className="list-disc pl-5 text-sm">
            {workmap.open_questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
