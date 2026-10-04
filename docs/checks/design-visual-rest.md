# design-visual-rest (T-0150, fix round T-0154): app vs canvas, remaining screens

Date: 2026-10-04. Pairs in `docs/design/compare/<screen>-app.png` / `<screen>-canvas.png`, 1440x900 (phone 390x844).

How the app shots were taken: local mode (`npx next dev` without Supabase env). Fixture-backed routes, all local mode only (404 otherwise):

- `/agents/preview/pip?tab=...` agent page (fixtures in `src/lib/fixtures/agents.ts`, Pip learns from Sabine Keller, confirmed maps)
- `/learn/preview` Learn with Pip selected
- `/workspace/preview` owner workspace (`src/lib/fixtures/workspace.ts`)
- `/login/preview` sign-in card (local mode redirects `/login` to `/capture`)
- `/agents/new/preview` new agent step 1, `?step=2` steps 2 and 3 (fixture agent Pip, expert picker over the fixture members)
- `/map/preview` Pip's confirmed invoice Work Map (`src/lib/fixtures/preview.ts`)
- `/debrief/preview` debrief in progress (follow-up, live answer, understanding per step), `?state=teach_back` the teach-back
- `/teach/preview` live Teach session (step 4 of 7, watching chips, transcript, replay card)
- Any route takes `?theme=light` (or `dark`) to force the theme; used for the light shots
- Phone: headless Chrome will not go below 500 px wide, so the app is shot inside a 390x844 iframe and cropped

Canvas notes: the canvas files render without the design runtime. `{{...}}` placeholders and `<dc-import>` avatars show as text or empty space. The wrapper artboards (LandingLight, LoginSent, NewAgent2, NewAgent3, AgentShortcuts, AgentGuardrails, AgentLearners, AgentSettings, WorkMapLight, TeachSummary) are a single `<dc-import>` of their parent with a prop and render blank. Their canvas png is therefore the parent artboard.

## Done: only data differences remain

| Screen | Data-only differences |
|---|---|
| main | CTA reads "Open the app" in local mode ("Sign in" with Supabase, behaviour). The canvas leaves the avatar slot empty, the app draws Pip. |
| landing-phone | Same CTA label. The canvas footer row is cut off by the frame. |
| login | The canvas stacks the sent state under the form, so the card sits higher. The app shows the email field empty. |
| agent (processes) | Process names, counts and scores come from fixtures. The canvas shows placeholders and a separate team line ("Accounts Payable, 31 years") that the app has no data for. |
| studio | Back link reads "Agent" (the studio route does not load the agent name). The canvas shows placeholders. |
| work-map | Step titles, quotes and scores come from the seeded session. The badge has no confirm date because the session has none. |
| workspace | Member list, counts and invite dates come from fixtures. The Agents and Last active columns are left out because the app has no data for them. |
| shell / sidebar | The canvas sidebar has fixture sessions and search. The app shows "No sessions yet." in local mode. |

## Closed in T-0154 (data-only differences now)

| Screen | Data-only differences |
|---|---|
| landing-light | Same CTA label as main. The canvas png is the dark Main (see below); the app shot is the light theme via `?theme=light`. |
| work-map-light | App shot is `/map/preview?theme=light`. Step titles and scores are fixtures; no frame stored, so the screen moment shows "no frame for this moment". |
| new-agent | Fixture values in the fields. The canvas expert chip has a coloured avatar; the app chip uses the neutral `--s3` token (no per-person colour data). |
| new-agent-2 / new-agent-3 | Both steps show together after step 1 (behaviour), so one shot covers both; step 3 has the "Running in AI Apprentice" status instead of pairing (behaviour). |
| agent-guardrails | Rules, quotes and step names are fixtures. Kind labels come from the Work Map vocabulary. |
| agent-shortcuts | Chords and counts are fixtures. The app has no "Seen" column and no "Showing 7 of 23" line: the Work Map stores no per-chord use count on steps. |
| learn | Agent order, process list and progress badge are data. The canvas "Companion paired" line is left out (no pairing, behaviour). The practice line lists the screen entities of the steps. |
| debrief | Header line has no task-ended / captured minutes (session data). "Skip this one" is not shown: the debrief controller has no skip action (behaviour). The canvas shows the teach-back under the question at the same time; the app shows it after the questions (`debrief-teach-back-app.png`). |
| teach | Header controls are the app's (Work Map select, Share screen, Pause, Finish) instead of Pause / Off the record / End session (behaviour). The replay card has no frame and timeline because the fixture stores no frame. Timestamps on transcript lines are not stored. |

## Not finished: impossible to compare headless

- **LandingLight, WorkMapLight, NewAgent2, NewAgent3, AgentShortcuts, AgentGuardrails, TeachSummary canvas side**: these artboards are a single `<dc-import>` of their parent with a prop and render blank without the design runtime. Their canvas png is the parent artboard (dark, or the parent's default tab). The light tokens themselves are checked against `Gallery.dc.html .lt` by `src/app/tokens.test.ts`.
- **Avatars on the canvas**: `<dc-import name="Avatar">` renders empty headless, so avatar size and position are compared against the slot, not the drawing.
