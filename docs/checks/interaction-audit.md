# Interaction audit (T-0166)

Date: 2026-10-04. Question: does every button, link and page do something?

## Method

- `src/app/interaction.guard.test.tsx` renders every page in local mode with fixture data (route list:
  `src/app/__audit/routes.tsx`) and records the props of every `button`, `[role=button]`, `a` and `next/link`
  element through a wrapped JSX runtime. Handlers stay visible that way without jsdom (A1: no new dependencies,
  package.json is out of scope). It sees the initial server render only: what opens on click (dialogs, the
  new-agent steps after the first) is covered by the behaviour tests in `src/app/interaction.behaviour.test.tsx`.
- An element passes with an href, an onClick, `type=submit`, or disabled with a stated reason (`title` or
  `data-reason`). App-only controls carry `data-app-only` and show as `app-only`.
- The table below is generated from that render pass. "before" was rendered from HEAD 354d8b2 (same test files
  copied into a clean worktree) before any edit; "after" from this branch. The test fails if a row is missing
  from the doc or the doc lists an element that does not render (A4).
- Shell controls (sidebar, user menu, workspace switcher, recent sessions) render on every app page; they are
  listed once under `/shell` (local user) and `/shell (signed in)` (owner of two workspaces, three recent sessions).
- `/dashboard` only redirects to /agents (not rendered). Routes that redirect in local mode (`/login`) or 404 on the empty local store (`/agents/[id]`, real ids) are
  covered by their preview routes, which render the same components with fixture data.

Status: works, app-only (disabled in the browser with reason and download link), disabled (with a reason),
dead (no action, fails the guard), missing (not rendered at HEAD).

## Findings

- At HEAD the render pass found no dead control. Earlier tasks had already wired the chips, the agent picker and
  '+', the filter tabs, the agent tabs, Settings (rename, role, studio, delete with confirm), Export guardrails,
  the screen-moment links, the Learners rows, invite, revoke, remove and the workspace switcher.
- Wired here: user menu account item and theme toggle (were missing); recent teach sessions open their summary
  (`/teach?session=<id>`, were sent to the debrief); Remove member and Revoke invite now ask for confirmation
  (A5: destructive actions confirm; errors already show in the page's status line).
- App-only (A5): `src/lib/desktop.ts` holds the single download location (`DESKTOP_APP_HREF`) and the reason text;
  `src/components/shell/AppOnly.tsx` renders the disabled browser variant on the server and during hydration and
  detects the desktop app on the client. Closest safe variant of item 3: at HEAD, Train/capture, Teach and voice
  run in the browser (screen share and browser voice), so disabling them would break working features. No current
  control is app-only; the primitive is ready for the first one. The home mic is disabled with a reason where the
  browser has no speech recognition.
- Theme persistence (A2): localStorage, re-applied by the shell on mount. Production renders no head script by
  design (src/app/layout.test.tsx), so a light choice can flash dark on first paint.

## Not built (nothing rendered, so nothing looks clickable)

- Member role change: needs `PATCH /api/workspace/members` and an owner-only update policy (store + migration);
  the member row shows the role as text. Left for a follow-up task with supabase/migrations in scope.
- Separate account page: the account item opens /workspace, which shows the email, role and sign-out.

## Decisions on the T-0165 amendments

- A1: JSX runtime wrapper under SSR, no jsdom. It cannot reach state after a click; behaviour tests cover those.
- A2: role change not built (above); account = /workspace; theme = client only.
- A3: allowlist in `src/lib/audit/allowlist.ts`; it must equal the Remaining list below. Both are empty.
- A4: table generated from the render pass; test asserts doc rows equal rendered elements.
- A5: as above.
- A6: the task asks for a commit on the task branch; one commit per page group was not needed, the change is small.

## Remaining

(none)

## Table

| route | element | label | intended action | before | after | note |
| --- | --- | --- | --- | --- | --- | --- |
| / | a | AI Apprentice | Scrolls to #top | works | works |  |
| / | a | How it works | Scrolls to #how | works | works |  |
| / | a | Open the app | Opens /capture | works | works |  |
| / | a | See how it works | Scrolls to #how | works | works |  |
| / | a | The Apprentice Test | Scrolls to #test | works | works |  |
| / | a | Trust | Scrolls to #trust | works | works |  |
| /agents | a | Create your first agent | Opens /agents/new | works | works |  |
| /agents | a | Install the companion | Opens https://github.com/K3NTAW/ai-apprentice/blob/main/companion/README.md | works | works |  |
| /agents | a | Invite an expert | Opens /workspace | works | works |  |
| /agents | a | New agent | Opens /agents/new | works | works |  |
| /agents | a | Open a Work Map | Opens /map | works | works |  |
| /agents | a | Teach a new employee | Opens /learn | works | works |  |
| /agents | button | Send | Submits the form (Send) | works | works |  |
| /agents | button | Speak | Runs 'Speak' in place | works | works |  |
| /agents/[id]/studio | a | Agent | Opens /agents/pip | works | works |  |
| /agents/[id]/studio | button | Accent #264653 | Runs 'Accent #264653' in place | works | works |  |
| /agents/[id]/studio | button | Accent #2A9D8F | Runs 'Accent #2A9D8F' in place | works | works |  |
| /agents/[id]/studio | button | Accent #5E60CE | Runs 'Accent #5E60CE' in place | works | works |  |
| /agents/[id]/studio | button | Accent #7FB7BE | Runs 'Accent #7FB7BE' in place | works | works |  |
| /agents/[id]/studio | button | Accent #8AB17D | Runs 'Accent #8AB17D' in place | works | works |  |
| /agents/[id]/studio | button | Accent #A3A3A3 | Runs 'Accent #A3A3A3' in place | works | works |  |
| /agents/[id]/studio | button | Accent #B5838D | Runs 'Accent #B5838D' in place | works | works |  |
| /agents/[id]/studio | button | Accent #C77DFF | Runs 'Accent #C77DFF' in place | works | works |  |
| /agents/[id]/studio | button | Accent #E76F51 | Runs 'Accent #E76F51' in place | works | works |  |
| /agents/[id]/studio | button | Accent #E9C46A | Runs 'Accent #E9C46A' in place | works | works |  |
| /agents/[id]/studio | button | Accent #F4A261 | Runs 'Accent #F4A261' in place | works | works |  |
| /agents/[id]/studio | button | Accent #FF8FAB | Runs 'Accent #FF8FAB' in place | works | works |  |
| /agents/[id]/studio | button | Body colour #264653 | Runs 'Body colour #264653' in place | works | works |  |
| /agents/[id]/studio | button | Body colour #2A9D8F | Runs 'Body colour #2A9D8F' in place | works | works |  |
| /agents/[id]/studio | button | Body colour #5E60CE | Runs 'Body colour #5E60CE' in place | works | works |  |
| /agents/[id]/studio | button | Body colour #7FB7BE | Runs 'Body colour #7FB7BE' in place | works | works |  |
| /agents/[id]/studio | button | Body colour #8AB17D | Runs 'Body colour #8AB17D' in place | works | works |  |
| /agents/[id]/studio | button | Body colour #A3A3A3 | Runs 'Body colour #A3A3A3' in place | works | works |  |
| /agents/[id]/studio | button | Body colour #B5838D | Runs 'Body colour #B5838D' in place | works | works |  |
| /agents/[id]/studio | button | Body colour #C77DFF | Runs 'Body colour #C77DFF' in place | works | works |  |
| /agents/[id]/studio | button | Body colour #E76F51 | Runs 'Body colour #E76F51' in place | works | works |  |
| /agents/[id]/studio | button | Body colour #E9C46A | Runs 'Body colour #E9C46A' in place | works | works |  |
| /agents/[id]/studio | button | Body colour #F4A261 | Runs 'Body colour #F4A261' in place | works | works |  |
| /agents/[id]/studio | button | Body colour #FF8FAB | Runs 'Body colour #FF8FAB' in place | works | works |  |
| /agents/[id]/studio | button | Export PNG | Runs 'Export PNG' in place | works | works |  |
| /agents/[id]/studio | button | Export SVG | Runs 'Export SVG' in place | works | works |  |
| /agents/[id]/studio | button | Randomize | Runs 'Randomize' in place | works | works |  |
| /agents/[id]/studio | button | Save | Runs 'Save' in place | works | works |  |
| /agents/[id]/studio | button | asking | Runs 'asking' in place | works | works |  |
| /agents/[id]/studio | button | bean | Runs 'bean' in place | works | works |  |
| /agents/[id]/studio | button | blob | Runs 'blob' in place | works | works |  |
| /agents/[id]/studio | button | calm | Runs 'calm' in place | works | works |  |
| /agents/[id]/studio | button | curious | Runs 'curious' in place | works | works |  |
| /agents/[id]/studio | button | focus | Runs 'focus' in place | works | works |  |
| /agents/[id]/studio | button | happy | Runs 'happy' in place | works | works |  |
| /agents/[id]/studio | button | idle | Runs 'idle' in place | works | works |  |
| /agents/[id]/studio | button | listening | Runs 'listening' in place | works | works |  |
| /agents/[id]/studio | button | paused | Runs 'paused' in place | works | works |  |
| /agents/[id]/studio | button | pill | Runs 'pill' in place | works | works |  |
| /agents/[id]/studio | button | robot | Runs 'robot' in place | works | works |  |
| /agents/[id]/studio | button | round | Runs 'round' in place | works | works |  |
| /agents/[id]/studio | button | smile | Runs 'smile' in place | works | works |  |
| /agents/[id]/studio | button | square | Runs 'square' in place | works | works |  |
| /agents/[id]/studio | button | star | Runs 'star' in place | works | works |  |
| /agents/[id]/studio | button | stop | Runs 'stop' in place | works | works |  |
| /agents/[id]/studio | button | talking | Runs 'talking' in place | works | works |  |
| /agents/[id]/studio | button | thinking | Runs 'thinking' in place | works | works |  |
| /agents/[id]/studio | button | wink | Runs 'wink' in place | works | works |  |
| /agents/new | a | Agents / | Opens /agents | works | works |  |
| /agents/new | a | Cancel | Opens /agents | works | works |  |
| /agents/new | button | Continue | Submits the form (Continue) | works | works |  |
| /agents/new/preview | a | Agents / | Opens /agents | works | works |  |
| /agents/new/preview | a | Cancel | Opens /agents | works | works |  |
| /agents/new/preview | button | Continue | Submits the form (Continue) | works | works |  |
| /agents/new/preview?step=2 | a | Agent | Opens /agents/pip | works | works |  |
| /agents/new/preview?step=2 | a | Agents / | Opens /agents | works | works |  |
| /agents/new/preview?step=2 | a | Start training | Opens /capture | works | works |  |
| /agents/new/preview?step=2 | button | Accent #264653 | Runs 'Accent #264653' in place | works | works |  |
| /agents/new/preview?step=2 | button | Accent #2A9D8F | Runs 'Accent #2A9D8F' in place | works | works |  |
| /agents/new/preview?step=2 | button | Accent #5E60CE | Runs 'Accent #5E60CE' in place | works | works |  |
| /agents/new/preview?step=2 | button | Accent #7FB7BE | Runs 'Accent #7FB7BE' in place | works | works |  |
| /agents/new/preview?step=2 | button | Accent #8AB17D | Runs 'Accent #8AB17D' in place | works | works |  |
| /agents/new/preview?step=2 | button | Accent #A3A3A3 | Runs 'Accent #A3A3A3' in place | works | works |  |
| /agents/new/preview?step=2 | button | Accent #B5838D | Runs 'Accent #B5838D' in place | works | works |  |
| /agents/new/preview?step=2 | button | Accent #C77DFF | Runs 'Accent #C77DFF' in place | works | works |  |
| /agents/new/preview?step=2 | button | Accent #E76F51 | Runs 'Accent #E76F51' in place | works | works |  |
| /agents/new/preview?step=2 | button | Accent #E9C46A | Runs 'Accent #E9C46A' in place | works | works |  |
| /agents/new/preview?step=2 | button | Accent #F4A261 | Runs 'Accent #F4A261' in place | works | works |  |
| /agents/new/preview?step=2 | button | Accent #FF8FAB | Runs 'Accent #FF8FAB' in place | works | works |  |
| /agents/new/preview?step=2 | button | Body colour #264653 | Runs 'Body colour #264653' in place | works | works |  |
| /agents/new/preview?step=2 | button | Body colour #2A9D8F | Runs 'Body colour #2A9D8F' in place | works | works |  |
| /agents/new/preview?step=2 | button | Body colour #5E60CE | Runs 'Body colour #5E60CE' in place | works | works |  |
| /agents/new/preview?step=2 | button | Body colour #7FB7BE | Runs 'Body colour #7FB7BE' in place | works | works |  |
| /agents/new/preview?step=2 | button | Body colour #8AB17D | Runs 'Body colour #8AB17D' in place | works | works |  |
| /agents/new/preview?step=2 | button | Body colour #A3A3A3 | Runs 'Body colour #A3A3A3' in place | works | works |  |
| /agents/new/preview?step=2 | button | Body colour #B5838D | Runs 'Body colour #B5838D' in place | works | works |  |
| /agents/new/preview?step=2 | button | Body colour #C77DFF | Runs 'Body colour #C77DFF' in place | works | works |  |
| /agents/new/preview?step=2 | button | Body colour #E76F51 | Runs 'Body colour #E76F51' in place | works | works |  |
| /agents/new/preview?step=2 | button | Body colour #E9C46A | Runs 'Body colour #E9C46A' in place | works | works |  |
| /agents/new/preview?step=2 | button | Body colour #F4A261 | Runs 'Body colour #F4A261' in place | works | works |  |
| /agents/new/preview?step=2 | button | Body colour #FF8FAB | Runs 'Body colour #FF8FAB' in place | works | works |  |
| /agents/new/preview?step=2 | button | Export PNG | Runs 'Export PNG' in place | works | works |  |
| /agents/new/preview?step=2 | button | Export SVG | Runs 'Export SVG' in place | works | works |  |
| /agents/new/preview?step=2 | button | Randomize | Runs 'Randomize' in place | works | works |  |
| /agents/new/preview?step=2 | button | Save | Runs 'Save' in place | works | works |  |
| /agents/new/preview?step=2 | button | asking | Runs 'asking' in place | works | works |  |
| /agents/new/preview?step=2 | button | bean | Runs 'bean' in place | works | works |  |
| /agents/new/preview?step=2 | button | blob | Runs 'blob' in place | works | works |  |
| /agents/new/preview?step=2 | button | calm | Runs 'calm' in place | works | works |  |
| /agents/new/preview?step=2 | button | curious | Runs 'curious' in place | works | works |  |
| /agents/new/preview?step=2 | button | focus | Runs 'focus' in place | works | works |  |
| /agents/new/preview?step=2 | button | happy | Runs 'happy' in place | works | works |  |
| /agents/new/preview?step=2 | button | idle | Runs 'idle' in place | works | works |  |
| /agents/new/preview?step=2 | button | listening | Runs 'listening' in place | works | works |  |
| /agents/new/preview?step=2 | button | paused | Runs 'paused' in place | works | works |  |
| /agents/new/preview?step=2 | button | pill | Runs 'pill' in place | works | works |  |
| /agents/new/preview?step=2 | button | robot | Runs 'robot' in place | works | works |  |
| /agents/new/preview?step=2 | button | round | Runs 'round' in place | works | works |  |
| /agents/new/preview?step=2 | button | smile | Runs 'smile' in place | works | works |  |
| /agents/new/preview?step=2 | button | square | Runs 'square' in place | works | works |  |
| /agents/new/preview?step=2 | button | star | Runs 'star' in place | works | works |  |
| /agents/new/preview?step=2 | button | stop | Runs 'stop' in place | works | works |  |
| /agents/new/preview?step=2 | button | talking | Runs 'talking' in place | works | works |  |
| /agents/new/preview?step=2 | button | thinking | Runs 'thinking' in place | works | works |  |
| /agents/new/preview?step=2 | button | wink | Runs 'wink' in place | works | works |  |
| /agents/preview | a | Invite an expert | Opens /workspace | works | works |  |
| /agents/preview | a | New agent | Opens /agents/new | works | works |  |
| /agents/preview | a | New agent Name it, give it a face, then train it on real wor | Opens /agents/new | works | works |  |
| /agents/preview | a | Open a Work Map | Opens /map | works | works |  |
| /agents/preview | a | Ready to teach Trained 2026-09-15 Bolt IT Service Desk Lead | Opens /agents/bolt | works | works |  |
| /agents/preview | a | Ready to teach Trained 2026-09-21 Otto Plant Controller UG l | Opens /agents/otto | works | works |  |
| /agents/preview | a | Ready to teach Trained 2026-09-27 Juno Senior Sales Person M | Opens /agents/juno | works | works |  |
| /agents/preview | a | Ready to teach Trained 2026-10-02 Pip Senior AP Clerk SK lea | Opens /agents/pip | works | works |  |
| /agents/preview | a | Start a session | Opens /capture | works | works |  |
| /agents/preview | a | Teach a new employee | Opens /learn | works | works |  |
| /agents/preview | a | Train Bolt | Opens /capture | works | works |  |
| /agents/preview | a | Training Trained 2026-10-04 Nova Payroll Specialist BR learn | Opens /agents/nova | works | works |  |
| /agents/preview | button | All 5 | Runs 'All 5' in place | works | works |  |
| /agents/preview | button | Ready to teach 4 | Runs 'Ready to teach 4' in place | works | works |  |
| /agents/preview | button | Send | Submits the form (Send) | works | works |  |
| /agents/preview | button | Speak | Runs 'Speak' in place | works | works |  |
| /agents/preview | button | Training 1 | Runs 'Training 1' in place | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Agents / Pip | Opens /agents | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Export guardrails | Opens /api/export | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Guardrails 8 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Learners 3 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Processes 2 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Screen moment 00:40 | Opens /map/pip-2#step-1 | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Screen moment 01:20 | Opens /map/pip-2#step-2 | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Screen moment 02:00 | Opens /map/pip-2#step-3 | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Screen moment 07:00 | Opens /map/pip-1#step-2 | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Screen moment 14:00 | Opens /map/pip-1#step-4 | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Screen moment 17:30 | Opens /map/pip-1#step-5 | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Screen moment 21:00 | Opens /map/pip-1#step-6 | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Settings | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Shortcuts | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Teach a new employee | Opens /learn | works | works |  |
| /agents/preview/[id]?tab=guardrails | a | Train | Opens /capture | works | works |  |
| /agents/preview/[id]?tab=learners | a | Agents / Pip | Opens /agents | works | works |  |
| /agents/preview/[id]?tab=learners | a | Code incoming supplier invoices | Opens /map/pip-1 | works | works |  |
| /agents/preview/[id]?tab=learners | a | Guardrails 8 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=learners | a | Learners 3 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=learners | a | Processes 2 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=learners | a | Release a payment run | Opens /map/pip-2 | works | works |  |
| /agents/preview/[id]?tab=learners | a | Settings | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=learners | a | Shortcuts | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=learners | a | Teach a new employee | Opens /learn | works | works |  |
| /agents/preview/[id]?tab=learners | a | Train | Opens /capture | works | works |  |
| /agents/preview/[id]?tab=processes | a | Agents / Pip | Opens /agents | works | works |  |
| /agents/preview/[id]?tab=processes | a | Guardrails 8 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=processes | a | Learners 3 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=processes | a | Open map | Opens /map/pip-1 | works | works |  |
| /agents/preview/[id]?tab=processes | a | Processes 2 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=processes | a | Settings | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=processes | a | Shortcuts | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=processes | a | Teach a new employee | Opens /learn | works | works |  |
| /agents/preview/[id]?tab=processes | a | Train | Opens /capture | works | works |  |
| /agents/preview/[id]?tab=processes | a | Train a new process | Opens /capture | works | works |  |
| /agents/preview/[id]?tab=settings | a | Agents / Pip | Opens /agents | works | works |  |
| /agents/preview/[id]?tab=settings | a | Guardrails 8 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=settings | a | Learners 3 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=settings | a | Open avatar studio | Opens /agents/pip/studio | works | works |  |
| /agents/preview/[id]?tab=settings | a | Processes 2 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=settings | a | Settings | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=settings | a | Shortcuts | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=settings | a | Teach a new employee | Opens /learn | works | works |  |
| /agents/preview/[id]?tab=settings | a | Train | Opens /capture | works | works |  |
| /agents/preview/[id]?tab=settings | button | Delete agent | Runs 'Delete agent' in place | works | works |  |
| /agents/preview/[id]?tab=settings | button | Save | Submits the form (Save) | works | works |  |
| /agents/preview/[id]?tab=shortcuts | a | Agents / Pip | Opens /agents | works | works |  |
| /agents/preview/[id]?tab=shortcuts | a | Guardrails 8 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=shortcuts | a | Learners 3 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=shortcuts | a | Processes 2 | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=shortcuts | a | Settings | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=shortcuts | a | Shortcuts | Opens /agents/pip | works | works |  |
| /agents/preview/[id]?tab=shortcuts | a | Teach a new employee | Opens /learn | works | works |  |
| /agents/preview/[id]?tab=shortcuts | a | Train | Opens /capture | works | works |  |
| /agents/preview/[id]?tab=shortcuts | button | All apps | Runs 'All apps' in place | works | works |  |
| /agents/preview/[id]?tab=shortcuts | button | Browser 1 | Runs 'Browser 1' in place | works | works |  |
| /agents/preview/[id]?tab=shortcuts | button | Excel 4 | Runs 'Excel 4' in place | works | works |  |
| /agents/preview/[id]?tab=shortcuts | button | Outlook 1 | Runs 'Outlook 1' in place | works | works |  |
| /agents/preview?empty=1 | a | Create your first agent | Opens /agents/new | works | works |  |
| /agents/preview?empty=1 | a | Install the companion | Opens https://github.com/K3NTAW/ai-apprentice/blob/main/companion/README.md | works | works |  |
| /agents/preview?empty=1 | a | Invite an expert | Opens /workspace | works | works |  |
| /agents/preview?empty=1 | a | New agent | Opens /agents/new | works | works |  |
| /agents/preview?empty=1 | a | Open a Work Map | Opens /map | works | works |  |
| /agents/preview?empty=1 | a | Teach a new employee | Opens /learn | works | works |  |
| /agents/preview?empty=1 | button | Send | Submits the form (Send) | works | works |  |
| /agents/preview?empty=1 | button | Speak | Runs 'Speak' in place | works | works |  |
| /auth/confirmed | a | AI Apprentice | Opens / | works | works |  |
| /auth/confirmed | a | Back to the site | Opens / | works | works |  |
| /capture | button | End task | Runs 'End task' in place | works | works |  |
| /capture | button | Off the record | Runs 'Off the record' in place | works | works |  |
| /capture | button | Pause | Runs 'Pause' in place | works | works |  |
| /capture | button | Share screen | Runs 'Share screen' in place | works | works |  |
| /capture | button | Start | Runs 'Start' in place | works | works |  |
| /capture/preview | a | Fix | Opens x-apple.systempreferences:com.apple.preference.security | works | works |  |
| /capture/preview | button | End task | Runs 'End task' in place | works | works |  |
| /capture/preview | button | Off the record | Runs 'Off the record' in place | works | works |  |
| /capture/preview | button | Pause | Runs 'Pause' in place | works | works |  |
| /capture/preview | button | Start | Runs 'Start' in place | works | works |  |
| /capture/preview | button | Stop sharing | Runs 'Stop sharing' in place | works | works |  |
| /debrief/[id] | a | Work Map / Debrief | Opens /map/preview | works | works |  |
| /debrief/preview | a | Finish later | Opens /map/pip-1 | works | works |  |
| /debrief/preview | a | Work Map / Debrief | Opens /map/pip-1 | works | works |  |
| /debrief/preview?state=teach_back | a | Finish later | Opens /map/pip-1 | works | works |  |
| /debrief/preview?state=teach_back | a | Work Map / Debrief | Opens /map/pip-1 | works | works |  |
| /debrief/preview?state=teach_back | button | Not quite | Runs 'Not quite' in place | works | works |  |
| /debrief/preview?state=teach_back | button | Yes, that is how it works | Runs 'Yes, that is how it works' in place | works | works |  |
| /learn/preview | a | Bolt IT Service Desk Lead · from Reto Frei | Opens /learn | works | works |  |
| /learn/preview | a | Code incoming supplier invoices 7 steps · 3 judgment calls · | Opens /teach | works | works |  |
| /learn/preview | a | Juno Senior Sales Person · from Marco Bianchi | Opens /learn | works | works |  |
| /learn/preview | a | Otto Plant Controller · from Urs Gerber | Opens /learn | works | works |  |
| /learn/preview | a | Pick another agent | Opens /learn | works | works |  |
| /learn/preview | a | Pip Senior AP Clerk · from Sabine Keller | Opens /learn | works | works |  |
| /learn/preview | a | Release a payment run 3 steps · 0 judgment calls · 3 guardra | Opens /teach | works | works |  |
| /learn/preview | a | Start | Opens /teach | works | works |  |
| /login/preview | a | AI Apprentice | Opens / | works | works |  |
| /login/preview | a | Back to the site | Opens / | works | works |  |
| /login/preview | button | Back to sign in | Runs 'Back to sign in' in place | works | works |  |
| /login/preview | button | Create account | Runs 'Create account' in place | works | works |  |
| /login/preview | button | Email me a link | Runs 'Email me a link' in place | works | works |  |
| /login/preview | button | Forgot password? | Runs 'Forgot password?' in place | works | works |  |
| /login/preview | button | Show | Runs 'Show' in place | works | works |  |
| /login/preview | button | Sign in | Submits the form (Sign in) | works | works |  |
| /map/preview | a | All Work Maps / Work Map | Opens /map | works | works |  |
| /map/preview | a | Export guardrails | Opens /api/export | works | works |  |
| /map/preview | a | Open in Teach | Opens /teach | works | works |  |
| /map/preview | a | invite a learner | Opens /workspace | works | works |  |
| /map/preview | button | 1 · 03:30 Open the invoice next to the mail | Runs '1 · 03:30 Open the invoice next to the mail' in place | works | works |  |
| /map/preview | button | 2 · 07:00 Check for a duplicate 1 guardrail | Runs '2 · 07:00 Check for a duplicate 1 guardrail' in place | works | works |  |
| /map/preview | button | 3 · 10:30 Read the line items | Runs '3 · 10:30 Read the line items' in place | works | works |  |
| /map/preview | button | 4 · 14:00 Code the invoice to a cost center 2 guardrails | Runs '4 · 14:00 Code the invoice to a cost center 2 guardrails' in place | works | works |  |
| /map/preview | button | 5 · 17:30 Send amounts over €5,000 to the controller 1 guard | Runs '5 · 17:30 Send amounts over €5,000 to the controller 1 guard' in place | works | works |  |
| /map/preview | button | 6 · 21:00 Second approval, Czech subsidiary 1 guardrail | Runs '6 · 21:00 Second approval, Czech subsidiary 1 guardrail' in place | works | works |  |
| /map/preview | button | 7 · 24:30 Post in the ERP and file the PDF | Runs '7 · 24:30 Post in the ERP and file the PDF' in place | works | works |  |
| /map/preview | button | Next step | Runs 'Next step' in place | works | works |  |
| /map/preview | button | Previous step | Runs 'Previous step' in place | works | works |  |
| /shell | a | AI Apprentice home | Opens / | works | works |  |
| /shell | a | Account and workspace | Opens /workspace | missing | works | new: user menu account item |
| /shell | a | Agents | Opens /agents | works | works |  |
| /shell | a | Get the desktop app | Opens /capture#companion | works | works |  |
| /shell | a | Learn | Opens /learn | works | works |  |
| /shell | a | Start capture | Opens /capture | works | works |  |
| /shell | a | Workspace | Opens /workspace | works | works |  |
| /shell | button | Light theme | Runs 'Light theme' in place | missing | works | new: theme toggle |
| /shell (signed in) | a | AI Apprentice home | Opens / | works | works |  |
| /shell (signed in) | a | Account and workspace | Opens /workspace | missing | works | new: user menu account item (email, role, workspace page) |
| /shell (signed in) | a | Agents | Opens /agents | works | works |  |
| /shell (signed in) | a | Capture · Sabine live · 11:00 | Opens /debrief/s-live | works | works |  |
| /shell (signed in) | a | Get the desktop app | Opens /capture#companion | works | works |  |
| /shell (signed in) | a | Learn | Opens /learn | works | works |  |
| /shell (signed in) | a | Start capture | Opens /capture | works | works |  |
| /shell (signed in) | a | Teach 2026-10-01 | Opens /teach | works (href /debrief/s-teach) | works | teach session now opens its summary (/teach?session=), was its debrief |
| /shell (signed in) | a | Work Map 11:00 | Opens /map/s-map | works | works |  |
| /shell (signed in) | a | Workspace | Opens /workspace | works | works |  |
| /shell (signed in) | button | Finance owner | Runs 'Finance owner' in place | works | works |  |
| /shell (signed in) | button | Light theme | Runs 'Light theme' in place | missing | works | new: theme toggle, data-theme + localStorage |
| /shell (signed in) | button | Ops learner | Runs 'Ops learner' in place | works | works |  |
| /shell (signed in) | button | Sign out | Submits the form (Sign out) | works | works |  |
| /teach | button | Finish | Runs 'Finish' in place | works | works |  |
| /teach | button | Pause | Runs 'Pause' in place | works | works |  |
| /teach | button | Share screen | Runs 'Share screen' in place | works | works |  |
| /teach | button | Start | Runs 'Start' in place | works | works |  |
| /teach/preview | button | Finish | Runs 'Finish' in place | works | works |  |
| /teach/preview | button | Pause | Runs 'Pause' in place | works | works |  |
| /teach/preview | button | Play | Runs 'Play' in place | works | works |  |
| /teach/preview | button | Send | Submits the form (Send) | works | works |  |
| /teach/preview | button | Stop sharing | Runs 'Stop sharing' in place | works | works |  |
| /workspace/preview | button | Invite | Submits the form (Invite) | works | works |  |
| /workspace/preview | button | Remove | Runs 'Remove' in place | works | works | now asks for confirmation first |
| /workspace/preview | button | Revoke | Runs 'Revoke' in place | works | works | now asks for confirmation first |
| /workspace/preview | button | expert | Runs 'expert' in place | works | works |  |
| /workspace/preview | button | learner | Runs 'learner' in place | works | works |  |
