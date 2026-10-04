# design-control-room-b: side-by-side checks (T-0144)

Open the canvas file next to the route at 1440 px, dark theme, and compare. Canvas files are in `docs/design/canvas/`.
Rule for canvas data the app does not have: the element is hidden, never invented. Hidden elements are listed per screen.

## Agent page: Processes (Agent.dc.html, tab=processes)
- Route: `/agents/<id>` -> `src/components/agents/AgentDetail.tsx`
- Compare: breadcrumb "Agents / name"; hero card (220 px stage column with 168 px avatar, `ui-td` name, "Ready to teach" badge, role 17 px, expert line, mono stats row, Train `bp bl` and "Teach a new employee" `bs bl`); tabs with counts; process rows (t3 task, counts, Confirmed badge, date, "Open map" `bs bsm`).
- Hidden (no data): the "Understood" % bar per process, the "Not yet confirmed" rows (only confirmed maps are listed), expert initials avatar.

## Agent page: Shortcuts (AgentShortcuts.dc.html, tab=shortcuts)
- Route: `/agents/<id>?tab=shortcuts`
- Compare: intro line, table header (Chord, App, What it does, Why in the expert's words), keycap chords, serif italic why, row padding 14/20.
- Hidden: app filter badges with counts, "Seen" column, "Showing n of m".

## Agent page: Guardrails (AgentGuardrails.dc.html, tab=guardrails)
- Route: `/agents/<id>?tab=guardrails`
- Compare: kind badges row (All, Limit, Exception, Stop and ask with counts), one card per guardrail (kind badge 120 px column, t3 rule, serif quote, task and step, "Screen moment mm:ss" `bs bsm`).
- Hidden: "Export guardrails" (lives on the Work Map), confirmed state per guardrail.

## Agent page: Learners (AgentLearners.dc.html, tab=learners)
- Route: `/agents/<id>?tab=learners`
- Compare: intro copy, table (Learner, Process, Mastery with badge + "n of m steps" + green bar, Last session mono).
- Hidden: learner avatar initials and "since" line, "Practice next" step names column, "Invite a learner" button.

## Agent page: Settings (AgentSettings.dc.html, tab=settings)
- Route: `/agents/<id>?tab=settings` -> `AgentSettings.tsx` (inner form unchanged in this task)
- Compare: tab selected state and spacing. Not rebuilt yet: the Questions while training / Privacy / Delete cards (follow-up).

## Work Map viewer (WorkMap.dc.html, WorkMapLight.dc.html)
- Route: `/map/<id>` -> `src/components/map/MapDetail.tsx` + `src/components/map/WorkMapViewer.tsx`
- Compare: breadcrumb, t1 task, "n steps · n judgment calls · n guardrails" (amber), Confirmed badge, Export guardrails `bs`, Open in Teach `bp`; step timeline (14 px step dot, 24 px amber judgment dot, selected ring `0 0 0 4px s1, 0 0 0 6px tx`, s2 background), legend; step card (eyebrow "Step n of N", kind and app badges, t2 title, frame, Decision); right column (reason in Instrument Serif italic 30 px, guardrail rows on s2, Understanding bars with the 75% line, Previous/Next).
- Light: same layout under the light theme tokens.
- Hidden: confirmation date, "Names redacted" overlay, 8 s clip copy.

## Debrief (Debrief.dc.html)
- Route: `/debrief/<id>` -> `src/components/debrief/DebriefApp.tsx`, `ScoreBars.tsx`, `TeachBackPanel.tsx`
- Compare: header (breadcrumb, t1 "Debrief", task); question card on stage (follow-up badge `k-ac`, "Asks until every step is above 75%", t2 quoted question, "About step n"); teach-back card (eyebrow, mono spoken length badge, 17 px text, `bp bl` / `bs bl`, hint line); right card "Understanding per step" with before (55% opacity) and gained bars, delta, legend, amber note.
- Hidden: avatar talking state, waveform and "Listening" button (voice state is not in the view), task end time and minutes captured, "Finish later".
- Note: a step's bar is the lower of its two scores (reason, guardrail captured).

## Learn (Learn.dc.html)
- Route: `/learn` -> `src/components/agents/LearnView.tsx`
- Compare: t1 "Learn" + 15 px intro; three cards with numbered circles (Agent, Process, Start); `.opt` rows (s2, 12 radius, selected accent border + radio 5 px); Start card on stage with 88 px avatar, t2 process, `bp bl` Start full width, cursor hint.
- Hidden: "Hi name" eyebrow, "Your progress n of m", minutes per process, focus steps, practice set, companion status line, disabled not-ready agents.

## Capture console (Capture.dc.html, without the pairing card)
- Route: `/capture` -> `src/components/capture/CaptureConsole.tsx`
- Compare: header (breadcrumb, t1, red Capturing badge with pulsing dot, controls group); Last question card on stage; Live events card (`ui-ev` rows: mono time, app chip, text); Questions so far (40 px mono number, "asked · n about guardrails" coral); Companion card shows the app status ("Running in AI Apprentice"); Share entire screen card with Sharing badge.
- Pairing digits and "Pair another device" are not shown (obsolete). `CompanionCard` stays as a component; `pair()` stays wired in CaptureApp but nothing in the console calls it.
- Hidden: elapsed timer, avatar, expert answer bubble and guardrail badges under the question, step/shortcut stat tiles, next-question countdown, screen preview.

## Teach console (Teach.dc.html)
- Route: `/teach` -> `src/components/teach/TeachConsole.tsx`
- Compare: header (breadcrumb, t1 task, green "Teaching on your screen" badge, Pause, Finish `bp`); current step card (eyebrow "Current step · n of N", judgment badge, t2 title, 6 px progress segments green/amber/accent/s3); Tutor transcript card as a chat thread (tutor bubbles plain, learner bubbles s3 22/22/6/22 right, stop bubble on `--cos`); composer at the bottom (26 radius, `--cmp`, "Answer out loud, or type here", Send `bp` 36 px); Replay card on stage with the quote in Instrument Serif italic 28 px; "On your screen now" card with the app status.
- Typed message: sent to the tutor as a text turn (`textTurn.ts`, `useVoiceAgent.promptTurn`); in text mode it is the scored answer. Input shows while a session runs (voice and text mode). Disconnected tutor: input disabled, error shown, message not sent.
- Hidden: timestamps per line, "Pip stayed quiet" activity lines, hold-to-talk mic button, "Pip is watching for" guardrail badges, replay scrubber.

## Teach summary (TeachSummary.dc.html)
- Route: `/teach` after Finish -> `TeachConsole` summary
- Compare: stage card (eyebrow "Session complete", t1 "Nice work. n of N steps mastered."), Mastered (`k-ok`) and Practice next (`k-jc`) cards with mono step numbers, footer note.
- Hidden: learner name, duration and date, per-step bars and notes, replay buttons, "Practice next now".
