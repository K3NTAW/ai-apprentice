# design-visual-rest (T-0150): app vs canvas, remaining screens

Date: 2026-10-04. Pairs in `docs/design/compare/<screen>-app.png` / `<screen>-canvas.png`, 1440x900 (phone 390x844).

How the app shots were taken: local mode (`npx next dev` without Supabase env). Fixture-backed routes, all local mode only (404 otherwise):

- `/agents/preview/pip?tab=...` agent page (fixtures in `src/lib/fixtures/agents.ts`, Pip learns from Sabine Keller, confirmed maps)
- `/learn/preview` Learn with Pip selected
- `/workspace/preview` owner workspace (`src/lib/fixtures/workspace.ts`)
- `/login/preview` sign-in card (local mode redirects `/login` to `/capture`)
- Work Map and Debrief read a session seeded into the gitignored `data/sessions/pip-1/session.json` (not committed)
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

## Not finished: non-data differences still open

- **landing-light, work-map-light**: the light theme was not shot. The toggle is client state and could not be reached headless. The pngs show the dark pair.
- **new-agent / new-agent-2 / new-agent-3**: step 1 matches. Still open:
  - the canvas has a "First task to learn" textarea and an expert picker with an avatar chip; the app has a plain expert text field
  - the canvas step indicator is plain text, the app has numbered circles
  - steps 2 and 3 need interaction, so they were not shot (all three app pngs show step 1)
- **agent-shortcuts / agent-guardrails / agent-learners / agent-settings**: the tab bodies were only checked against the Agent.dc.html sections. Still open:
  - guardrail rows: the canvas has a serif quote line, a status column, the play icon on "Screen moment" and an "Export guardrails" button
  - shortcuts: the per-app filter chips
- **debrief**: the app shot is the pre-start state ("Start debrief"). The canvas shows a debrief in progress (follow-up question, live answer, understanding per step, teach-back). That state needs a running voice session and was not compared.
- **teach / teach-summary**: the app shot is the idle demo state with the "On your screen now" desktop-app card. The canvas shows a live session (step progress, Pip watching chips, transcript, replay card). Not compared. The pairing and picker controls on the canvas are excluded on purpose (behaviour wins).
- **learn**: layout matches. Still open:
  - the canvas has a "HI LENA" eyebrow
  - non-ready agents are shown dimmed ("Still training"); the app hides them
  - the Start card has "Pip will focus on" and "Practice with" blocks
