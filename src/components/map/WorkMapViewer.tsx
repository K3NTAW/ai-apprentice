"use client";

// Work Map viewer, 1:1 with docs/design/canvas/WorkMap.dc.html (dark) and WorkMapLight.dc.html (same layout, light
// tokens): step timeline as tabs, step card with the screen moment and decision, the reason as the expert's italic
// serif quote, guardrails and the two understanding bars with the 75% threshold line, previous and next.
import { useState } from "react";
import { StepFrame } from "@/components/workmap/StepMoment";
import { Badge, Button, Card, ScoreBar } from "@/components/ui";
import { SCORE_THRESHOLD, type WorkMap, type WorkMapStep } from "@/lib/types";
import { formatT, guardrailKindLabel, sourceLabel } from "@/lib/workmap/view";

const GUARD_BADGE = { limit: "limit", exception: "exception", stop_and_ask: "stop_and_ask" } as const;
/** Canvas font of the reason quote (.quote): Instrument Serif italic. */
export const QUOTE_FONT = "'Instrument Serif', Georgia, serif";
const pct = (v: number) => Math.round(Math.max(0, Math.min(1, v)) * 100);

function StepDot({ step, selected, onPick }: { step: WorkMapStep; selected: boolean; onPick(): void }) {
  const d = step.is_judgment_call ? 24 : 14;
  const g = step.guardrails.length;
  return (
    <button
      type="button"
      role="tab"
      aria-selected={selected}
      onClick={onPick}
      data-step={step.n}
      className="flex flex-col items-center text-center"
      style={{ flex: 1, gap: 4, padding: "0 6px 10px", border: 0, borderRadius: 12, cursor: "pointer", color: "inherit", font: "inherit", background: selected ? "var(--s2)" : "transparent" }}
    >
      <span style={{ height: 36, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <span
          style={{
            width: d,
            height: d,
            borderRadius: "50%",
            background: step.is_judgment_call ? "var(--am)" : "var(--ac)",
            boxShadow: selected ? "0 0 0 4px var(--s1), 0 0 0 6px var(--tx)" : "0 0 0 4px var(--s1)",
          }}
        />
      </span>
      <span className="ui-mono text-xs" style={{ color: selected ? "var(--tx)" : "var(--fa)" }}>
        {step.n} · {formatT(step.screen_moment.t)}
      </span>
      <span className="text-[13px]" style={{ color: selected ? "var(--tx)" : "var(--mu)", fontWeight: 500, lineHeight: 1.3 }}>
        {step.title}
      </span>
      <span className="text-xs" style={{ color: g ? "var(--co)" : "var(--fa)" }}>
        {g ? `${g} ${g > 1 ? "guardrails" : "guardrail"}` : step.is_judgment_call ? "Judgment call" : " "}
      </span>
    </button>
  );
}

export default function WorkMapViewer({ sessionId, workmap, initial }: { sessionId: string; workmap: WorkMap; initial?: number }) {
  const steps = workmap.steps;
  const [i, setI] = useState(() => Math.max(0, Math.min(steps.length - 1, initial ?? 0)));
  const cur = steps[i];
  if (!cur) return <p className="text-[13px]" style={{ color: "var(--mu)" }}>This Work Map has no steps.</p>;
  const threshold = Math.round(SCORE_THRESHOLD * 100);
  return (
    <div className="flex flex-col" style={{ gap: 22 }} data-testid="workmap-viewer">
      <Card style={{ padding: "20px 16px 8px", overflowX: "auto" }}>
        <div className="relative" style={{ minWidth: 760 }}>
          <div className="absolute" style={{ left: "7%", right: "7%", top: 26, height: 2, background: "var(--ln2)" }} />
          <div className="relative flex" role="tablist" aria-label="Steps">
            {steps.map((s, k) => (
              <StepDot key={s.n} step={s} selected={k === i} onPick={() => setI(k)} />
            ))}
          </div>
        </div>
        <div className="flex flex-wrap text-xs" style={{ gap: 18, padding: "12px 8px 8px", borderTop: "1px solid var(--ln)", marginTop: 8, minWidth: 760, color: "var(--mu)" }}>
          <span className="inline-flex items-center" style={{ gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--ac)" }} />
            Step
          </span>
          <span className="inline-flex items-center" style={{ gap: 6 }}>
            <span style={{ width: 18, height: 18, borderRadius: "50%", background: "var(--am)" }} />
            Judgment call
          </span>
          <span className="inline-flex items-center" style={{ gap: 6 }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--ac)", boxShadow: "0 0 0 3px var(--s1), 0 0 0 5px var(--tx)" }} />
            Selected
          </span>
          <span>Click a step to see the screen moment and the reason</span>
        </div>
      </Card>

      <Card className="flex flex-wrap overflow-hidden" style={{ padding: 0 }}>
        <div className="flex min-w-0 flex-col" style={{ flex: "1 1 420px", padding: 28, gap: 18, borderRight: "1px solid var(--ln)" }} id={`step-${cur.n}`}>
          <div className="flex flex-wrap items-center justify-between" style={{ gap: 10 }}>
            <span className="ui-eb">
              Step {cur.n} of {steps.length}
            </span>
            <span className="flex" style={{ gap: 6 }}>
              {cur.is_judgment_call ? <Badge kind="judgment" /> : <Badge kind="accent">Step</Badge>}
              {cur.screen_moment.app && <Badge kind="pending">{cur.screen_moment.app}</Badge>}
            </span>
          </div>
          <h2 className="ui-t2">{cur.title}</h2>
          <div className="flex flex-col" style={{ gap: 10 }}>
            <StepFrame sessionId={sessionId} frameRef={cur.screen_moment.frame_ref} />
            <span className="ui-mono text-xs" style={{ color: "var(--fa)" }}>
              Screen moment {formatT(cur.screen_moment.t)} · {cur.screen_moment.entity}
            </span>
          </div>
          <div className="flex flex-col" style={{ gap: 6, paddingTop: 6, borderTop: "1px solid var(--ln)" }}>
            <span className="ui-eb">Decision</span>
            <p style={{ fontSize: 15 }}>{cur.decision}</p>
          </div>
        </div>

        <div className="flex min-w-0 flex-col" style={{ flex: "1 1 420px", padding: 28, gap: 24 }}>
          <div className="flex flex-col" style={{ gap: 10 }}>
            <span className="ui-eb">Reason, in {workmap.expert}&apos;s words</span>
            {cur.reason ? (
              <>
                <p data-testid="reason-quote" className="ui-qs" style={{ fontFamily: QUOTE_FONT, fontStyle: "italic", fontSize: 30, lineHeight: 1.15 }}>
                  &ldquo;{cur.reason.quote}&rdquo;
                </p>
                <span className="text-[13px]" style={{ color: "var(--mu)" }}>
                  {workmap.expert} · {sourceLabel(cur.reason.source)} at {formatT(cur.reason.t)}
                </span>
              </>
            ) : (
              <span className="text-[13px]" style={{ color: "var(--fa)" }}>No reason captured for this step.</span>
            )}
          </div>
          <div className="flex flex-col" style={{ gap: 10 }}>
            <span className="ui-eb">Guardrails</span>
            {cur.guardrails.length ? (
              <div className="flex flex-col" style={{ gap: 8 }}>
                {cur.guardrails.map((g, k) => (
                  <div key={k} className="flex items-start" style={{ gap: 12, padding: "12px 14px", borderRadius: 12, background: "var(--s2)" }}>
                    <Badge kind={GUARD_BADGE[g.kind]} className="flex-none">
                      {guardrailKindLabel(g.kind)}
                    </Badge>
                    <span className="text-[13px]">{g.rule}</span>
                  </div>
                ))}
              </div>
            ) : (
              <span className="text-[13px]" style={{ color: "var(--fa)" }}>No guardrail on this step.</span>
            )}
          </div>
          <div className="flex flex-col" style={{ gap: 14 }}>
            <span className="ui-eb">Understanding</span>
            <ScoreBar label="Knows why" value={pct(cur.scores.reason_captured)} threshold={threshold} />
            <ScoreBar label="Knows when to stop" value={pct(cur.scores.guardrail_captured)} threshold={threshold} />
            <span className="text-xs" style={{ color: "var(--fa)" }}>
              Line marks {threshold}%
            </span>
          </div>
          <div className="mt-auto flex flex-wrap justify-between" style={{ gap: 8 }}>
            <Button variant="ghost" size="sm" disabled={i === 0} onClick={() => setI(Math.max(0, i - 1))}>
              Previous step
            </Button>
            <Button variant="secondary" size="sm" disabled={i === steps.length - 1} onClick={() => setI(Math.min(steps.length - 1, i + 1))}>
              Next step
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}
