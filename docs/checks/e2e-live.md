# Live hands-on suite (e2e:live, T-0227)

Playwright run against the DEPLOYED app with a real test user. Requested by the human on 2026-10-04 08:25. It is not
part of `npm run e2e` (local mode) or the merge gate; a human runs it.

## Run

```sh
E2E_EMAIL=... E2E_PASSWORD=... BASE_URL=https://<deployed-app> npm run e2e:live
```

- `BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD` are required; the run stops before opening a browser if one is missing
  (names only are printed, never values).
- `E2E_HEADED=1` shows the browser; otherwise headless. Uses the installed Google Chrome (`channel: 'chrome'`).
- Config: `e2e/live/playwright.live.config.ts`. Specs: `e2e/live/*.spec.ts`. One worker, steps run in order.
- Put the credentials in the shell for this one command. Do not write them into `.env` files, scripts or notes.

## Credentials

- Read only in `e2e/live/env.ts`, from env. Never printed, logged, attached or written to disk.
- Trace, video and Playwright's own failure screenshots are off. The suite's screenshots mask the password and email
  fields and any element showing the email address.
- Console errors and failed request URLs are scrubbed of both values and query strings before they reach the summary.
- `e2e/live.guard.test.ts` (Vitest, part of `npm test`) fails if the config turns trace or video on, a screenshot call
  has no mask, or a spec logs, attaches or writes the credentials.

## Output

`e2e/live/out/` (gitignored):

- `NN-MM-<what>.png`: a screenshot of every step, NN is the step, MM the order inside it. A failed step also gets
  `NN-MM-failure.png`.
- `summary.md`: each step with pass/fail, duration, console errors, failed requests (status >= 400; 401 probes are
  only counted), app gaps found, and page load times (TTFB, DOMContentLoaded, load from navigation timing) for
  /agents, /learn, /map, /workspace and /capture.

## Steps

Each step is one test. A failed step restarts the browser, signs in again and the run continues.

1. Sign in with email and password. If the app redirects to onboarding (`e2e/live/onboarding.ts`): Workspace
   (Continue), Desktop permissions (Skip for now, desktop only), First agent (creates 'E2E Onboard' when the form
   shows), How training works (Next through the five cards, Later on the last). It resumes at whatever step is open and
   does nothing for a user who finished onboarding. `e2e/live-onboarding.guard.test.ts` (Vitest) runs the walk against
   a mocked page: fresh user, onboarded user, resumed user.
2. Agents home: search, filter tabs (Ready to teach, Training, All), the chips.
3. Create 'E2E Pip' with role, expert, first task; change the avatar in the studio and save.
4. Every agent tab: Processes, Shortcuts, Guardrails, Learners, Settings.
5. Settings: change every select, switch, Role, Expert and the off-the-record phrase; reload and check each persisted;
   reset to the values before; reload and check. Controls disabled for the user's role are listed in the summary.
6. Workspace: rename (see app gaps), invite `e2e-<timestamp>@example.com` and revoke it.
7. Create 'E2E Workspace' in the switcher, switch to it and back.
8. ⌘K palette: search 'E2E'.
9. Work Map list and the first Work Map if any.
10. Learn page.
11. Capture and Teach show the desktop-app notice in the browser.
12. User menu: theme toggle (and back), Account and workspace, Sign out, sign in again.
13. Clean up: delete every agent whose name starts with 'E2E ' (E2E Pip, E2E Onboard) and 'E2E Workspace'.
14. Page load times.

## Data it creates and removes

Everything the run creates starts with 'E2E ' (agents 'E2E Pip', 'E2E Onboard', workspace 'E2E Workspace') or is an
`example.com` invite. Step 13 deletes the agents; the invite is revoked in step 6. Re-running is safe: step 7 reuses an
existing 'E2E Workspace', and step 13 removes any 'E2E ' agents left by an earlier run.

The onboarding walk marks onboarding done for the test user; later runs sign in without it. To test onboarding again,
clear `onboarding_completed_at` in the user's metadata.

## App gaps found while writing it

Found by reading the code (the suite records them in the summary when it meets them):

- No way to rename a workspace: no control on /workspace or in the switcher, and no update route
  (`src/app/api/workspace/route.ts` has POST only). Step 6 records this instead of renaming.
- No way to delete a workspace: no control and no DELETE route. 'E2E Workspace' stays after the run; remove it in
  Supabase (table `workspaces`, and its memberships) until the app can.

## First live run (2026-10-04 ~12:00)

Against https://ai-apprentice-app.vercel.app with a fresh test user. Every step timed out in onboarding: the walk
clicked Later on card 1 of 'How training works', but Later only shows on card 5. Fixed in T-0254 (Next through the
cards). Not re-run against the deployed app yet. There is no local-mode (`npm run e2e`) onboarding spec; the seed
user is past onboarding, so the mocked-page test above covers the path.

## Not run here

The suite was written without credentials, so it has not run against the deployed app yet. Only the Vitest guard ran.
Selectors come from the current components; expect a first live run to need small fixes.
