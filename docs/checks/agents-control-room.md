# Manual checks: agents-control-room (T-0112)

Visual criteria are checked by hand (amendment A7); automated tests cover view models and route logic only.

## Theme and shell
- [ ] Dark theme by default: near-black background, 1 px subtle borders, one accent colour, system font.
- [ ] Light variant: set `data-theme="light"` on `<html>` in dev tools (or switch the OS to light); text and borders stay readable.
- [ ] Cards on /agents, /agents/<id> and /learn have 16 px rounded corners and generous spacing.
- [ ] From md width up the nav is a left sidebar (Agents, Learn, Workspace, Install companion); at phone width (390 px) it collapses to a top bar.
- [ ] Existing pages (Capture, Teach, Work Maps, Debrief, Workspace) still work as before inside the new shell.

## Flows
- [ ] Sign in: you land on /dashboard, which redirects to /agents.
- [ ] /agents with no agents: two-line empty state and '+ New agent' (owners and experts only).
- [ ] /agents/new: name, role, expert, Next; the avatar studio shows; save; 'Start training' opens /capture?agent=<id> with the agent's avatar and name in the header; the session created has agent_id.
- [ ] /capture?agent=<unknown id>: an error shows and Start does not create an agentless session.
- [ ] /agents/<id>: big animated avatar; tabs Processes, Shortcuts, Guardrails, Learners, Settings switch via ?tab=.
- [ ] Settings: rename and change role save; 'Open avatar studio' works; Delete shows a confirmation, only for owners; sessions stay and become agentless.
- [ ] /learn: only agents with a confirmed process; pick agent, then process; Teach opens with ?agent&session and shows the agent header.
- [ ] /teach?agent=<a>&session=<map of another agent>: an error shows and Start is blocked.

## Decisions
- Post-login home is /agents, reached through the /dashboard redirect. safeNext default, the auth callback local-mode
  redirect and the proxy (src/proxy.test.ts) keep /dashboard unchanged, so the move is one redirect.
- The old dashboard content: workflows per process move to the agent Processes tab, learner mastery to the Learners tab.
  Dashboard.tsx and MasteryLine stay (MasteryLine is used by the Work Map page).
- Rollback (A6): the shell and theme landed in their own commit; the /dashboard redirect is a separate commit, so
  reverting that commit alone restores the old dashboard.
- Capture seam (A1): src/components/capture/agentSession.ts creates the session with agent_id; src/lib/capture/httpApi.ts is unchanged.
- Shortcuts (A2): read defensively from steps[].shortcuts[] = {chord, app, what, why}, owned by the shortcuts task; the
  shared WorkMap type is unchanged here, and the tab shows an empty state until chords are recorded.
