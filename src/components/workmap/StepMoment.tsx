"use client";

// Screen moment + expert quote block. Shared by the Work Map viewer and the Teach replay.
import { useState } from "react";
import type { WorkMapStep } from "@/lib/types";
import { formatT, frameUrl, sourceLabel } from "@/lib/workmap/view";

export type StepMomentProps = {
  sessionId: string;
  expert: string;
  moment: WorkMapStep["screen_moment"];
  reason: WorkMapStep["reason"];
  compact?: boolean;
};

export function StepFrame({ sessionId, frameRef, compact }: { sessionId: string; frameRef?: string; compact?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  const size = compact ? "h-28" : "h-48";
  if (!frameRef || failed === frameRef) {
    return (
      <div className={`flex ${size} w-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-400`}>
        no frame for this moment
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={frameUrl(sessionId, frameRef)}
      alt={`screen at ${frameRef}`}
      className={`${size} w-full rounded border border-slate-200 bg-slate-50 object-contain`}
      onError={() => setFailed(frameRef)}
    />
  );
}

export function ExpertQuote({ expert, reason }: { expert: string; reason: WorkMapStep["reason"] }) {
  if (!reason) {
    return (
      <p className="rounded border border-amber-300 bg-amber-50 px-2 py-1 text-sm text-amber-800">
        reason not captured yet
      </p>
    );
  }
  return (
    <blockquote className="border-l-4 border-slate-300 pl-3">
      <p className="text-sm italic">&ldquo;{reason.quote}&rdquo;</p>
      <footer className="mt-1 text-xs text-slate-500">
        — {expert}, {sourceLabel(reason.source)} at {formatT(reason.t)}
      </footer>
    </blockquote>
  );
}

export default function StepMoment({ sessionId, expert, moment, reason, compact }: StepMomentProps) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs text-slate-600">
        <span className="font-mono">{formatT(moment.t)}</span>, {moment.entity}
        {moment.field ? `, ${moment.field} field` : ""}
      </p>
      <StepFrame sessionId={sessionId} frameRef={moment.frame_ref} compact={compact} />
      <ExpertQuote expert={expert} reason={reason} />
    </div>
  );
}
