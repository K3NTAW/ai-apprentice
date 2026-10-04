# Onboarding (T-0211)

First sign-in onboarding: Workspace, Desktop permissions, First agent, How training works.

## Where the redirect lives (A1)

- At sign-in only: `src/app/auth/callback/route.ts` (magic link) and `src/app/api/auth/bootstrap/route.ts` (password login) send a user whose onboarding is not completed to `/onboarding?next=<next>`.
- `src/proxy.ts` is not in this task's scope, so there is no per-request redirect. `/onboarding`, `/api/*`, `/auth/*` and `/login/*` never pass through the sign-in redirect, and `/onboarding` has no redirect of its own (no AppShell), so it cannot loop.
- Local mode has no sign-in, so no automatic redirect. Onboarding is reached from 'Finish setup' in the user menu.

## State model (A2, A3)

- Supabase `user_metadata`: `onboarding_completed_at` (ISO or null), `onboarding_steps` (`{workspace, permissions, agent, training}` each `done` or `skipped`), `onboarding_agent_id`.
- Written server side by `POST /api/auth/onboarding` with `supabase.auth.updateUser` on the session client. Local mode: `<DATA_DIR>/onboarding.json`, same route.
- Each step is saved when it is marked. `onboarding_completed_at` is set once every step is done or skipped. Leaving the page completes nothing.
- 'Finish setup' stays in the user menu while onboarding is not completed or any step is skipped.
- Write failure: the page shows the error and moves on. Skip never blocks. Since the redirect only runs at sign-in, a failed write cannot trap the user.
- Grandfathering: users created before 2026-10-04T00:00:00Z, or with no `created_at`, count as completed.

## Steps

1. Workspace: shows the active workspace with its city. Invite case (any membership with a role other than owner, from the request context memberships): 'You joined <name> as <role>'. 'Create another workspace' uses `POST /api/workspace` (name, optional city). Renaming the auto-created workspace is left out (A5): there is no update policy or route for `workspaces`, and `src/app/api/workspace/**` and migrations are out of scope. Local mode: one file-backed workspace, no create.
2. Desktop permissions: in the app, rows from the bridge `status` event. The payload has `screen`, `accessibility` and `input` (Input monitoring); it has no microphone field, so Microphone shows 'Unknown' unless a newer app sends `permissions.microphone` (A4: no protocol change). 'Grant' calls `window.apprentice.openPermissionSettings(kind)`. 'Restart app' shows when the bridge lists `relaunch` in `window.apprentice.windowActions` and calls `window('relaunch')`. Companion: `windowActions.mts` (`relaunch` action), `main.mts` (`app.relaunch()` + `app.exit(0)`), `preloadApp.cts` (allowlist and `windowActions`), test in `window.test.ts`. In the browser: 'Get the desktop app' with the download links.
3. First agent: `NewAgentFlow` with `embedded={{ onCreated }}` hides its stepper, Cancel and step 3. The created id is stored as `onboarding_agent_id` and passed back as `initialAgentId` on resume, so no second agent is made. Experts: `loadExpertOptions` from `src/app/agents/new/experts.ts` (imported, not edited). Learners see a note and skip.
4. How training works: five cards. Art follows `docs/design/canvas/Dock.dc.html`, `docs/design/canvas/OffRecord.dc.html`, `docs/design/canvas/Buddy.dc.html`. Chords from the desktop defaults in `companion/src/shortcuts.mts` (⌥⇧O, ⌥⇧E); a test fails on drift. 'Start your first training' marks the step done and opens `/capture?agent=<id>`. 'Later' marks it skipped and goes to next.

## Kill switch and rollback (A8)

- `ONBOARDING_ENABLED=0` (or `false`, `off`) turns off the sign-in redirect and the menu entry. Default on.
- Rollback: revert the T-0211 commit. No migration; leftover `onboarding_*` metadata keys are ignored.

## Manual checks

- New account, magic link: lands on `/onboarding`. Skip all four steps: lands on next; 'Finish setup' still in the user menu.
- Sign in again after skipping: no redirect.
- Desktop app: grant Accessibility, check mark appears after the status update; 'Restart app' restarts.
- Browser: step 2 shows 'Get the desktop app'.
- Create an agent in step 3, reload `/onboarding?step=agent`: the avatar studio of the same agent, no duplicate.
- 'Start your first training' opens Capture with the agent selected.

## Approval

Commits on the task branch were requested in the task instructions for T-0211 (2026-10-04), which counts as the approval CLAUDE.md asks for. Pushes and merges stay with the human.
