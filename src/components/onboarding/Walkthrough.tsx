"use client";
// Step 4 How training works: five cards, one at a time. Illustrations are small takes on the canvas artboards
// docs/design/canvas/Dock.dc.html (dock, quiet), OffRecord.dc.html (off the record, end) and Buddy.dc.html (buddy).
import { useState } from "react";
import { buttonClass } from "@/components/ui";
import { WALKTHROUGH, type WalkthroughArt } from "@/lib/onboarding/walkthrough";

function Art({ art }: { art: WalkthroughArt }) {
  const screen = <rect x="8" y="8" width="224" height="120" rx="10" fill="var(--s2)" stroke="var(--ln2)" />;
  const dock = <rect x="196" y="20" width="28" height="96" rx="14" fill="var(--s1)" stroke="var(--ln2)" />;
  const agent = (cx: number, cy: number) => <circle cx={cx} cy={cy} r="9" fill="var(--pb)" />;
  return (
    <svg viewBox="0 0 240 136" className="h-[136px] w-full" aria-hidden="true" data-art={art}>
      {screen}
      {art !== "buddy" && dock}
      {art === "dock" && agent(210, 40)}
      {art === "quiet" && (
        <>
          {agent(210, 40)}
          <rect x="24" y="30" width="120" height="8" rx="4" fill="var(--ln2)" />
          <rect x="24" y="46" width="90" height="8" rx="4" fill="var(--ln2)" />
          <rect x="70" y="80" width="118" height="26" rx="13" fill="var(--s1)" stroke="var(--ln2)" />
          <text x="129" y="97" textAnchor="middle" fontSize="11" fill="var(--mu)">Why this account?</text>
        </>
      )}
      {art === "offrecord" && (
        <>
          <circle cx="210" cy="40" r="9" fill="var(--fa)" />
          <rect x="40" y="56" width="132" height="26" rx="13" fill="var(--s1)" stroke="var(--ln2)" />
          <text x="106" y="73" textAnchor="middle" fontSize="11" fill="var(--tx)">Off the record</text>
        </>
      )}
      {art === "end" && (
        <>
          {agent(210, 40)}
          <rect x="30" y="28" width="150" height="80" rx="10" fill="var(--s1)" stroke="var(--ln2)" />
          <text x="105" y="52" textAnchor="middle" fontSize="11" fill="var(--tx)">Debrief</text>
          <rect x="46" y="64" width="118" height="7" rx="3.5" fill="var(--ln2)" />
          <rect x="46" y="80" width="84" height="7" rx="3.5" fill="var(--ln2)" />
        </>
      )}
      {art === "buddy" && (
        <>
          <rect x="60" y="56" width="70" height="24" rx="8" fill="none" stroke="var(--pb)" strokeWidth="2" />
          <path d="M140 92 l0 18 l5 -5 l6 9 l4 -2 l-6 -9 l7 -1 z" fill="var(--tx)" />
          {agent(166, 100)}
          <rect x="150" y="60" width="72" height="22" rx="11" fill="var(--s1)" stroke="var(--ln2)" />
          <text x="186" y="75" textAnchor="middle" fontSize="10" fill="var(--tx)">Click here next</text>
        </>
      )}
    </svg>
  );
}

export default function Walkthrough({ onStart, onLater, busy }: { onStart: () => void; onLater: () => void; busy?: boolean }) {
  const [i, setI] = useState(0);
  const card = WALKTHROUGH[i];
  const last = i === WALKTHROUGH.length - 1;
  return (
    <div className="flex flex-col gap-4" data-testid="walkthrough" data-card={i + 1}>
      <div className="rounded-[12px] p-3" style={{ background: "var(--stage)" }}>
        <Art art={card.art} />
      </div>
      <div className="flex flex-col gap-1">
        <span className="ui-eb">
          {i + 1} of {WALKTHROUGH.length}
        </span>
        <h3 className="ui-t2">{card.title}</h3>
        <p style={{ color: "var(--mu)" }}>{card.body}</p>
      </div>
      <div className="flex flex-wrap justify-between gap-3">
        <button type="button" className={buttonClass("ghost")} onClick={() => setI(Math.max(0, i - 1))} disabled={i === 0} title="This is the first card">
          Back
        </button>
        {last ? (
          <span className="flex flex-wrap gap-3">
            <button type="button" className={buttonClass("ghost")} onClick={onLater} disabled={busy} title="Saving">
              Later
            </button>
            <button type="button" className={buttonClass("primary")} onClick={onStart} disabled={busy} title="Saving">
              Start your first training
            </button>
          </span>
        ) : (
          <button type="button" className={buttonClass("primary")} onClick={() => setI(i + 1)}>
            Next
          </button>
        )}
      </div>
    </div>
  );
}
