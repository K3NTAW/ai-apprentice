# E2E click-through (T-0168 -> T-0172 -> T-0173 -> T-0247)

## How to run

```
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm ci   # once; no browser download, drives the installed Google Chrome
npm run e2e                                 # playwright test
```

- `playwright.config.ts`: channel `chrome`, headless, 1 worker, `retries: 0`, `forbidOnly`, `testIgnore: "live/**"` (the
  live suite runs only with `npm run e2e:live`).
- Part of the pre-PR checks in `docs/DEPLOY.md`. `e2e/e2e.guard.test.ts` (Vitest, no browser) checks the script, the
  live ignore and that the pre-PR list names `npm run e2e`.
- webServer: `node e2e/seed.mjs && next dev --port 3217`, `reuseExistingServer: false`, timeout 180 s. `next dev` because
  NODE_ENV=development resolves appMode to `local`; a production build would be `misconfigured`.
- Seed: `e2e/seed.mjs` writes into `$TMPDIR/ai-apprentice-e2e` (never `./data`, it refuses a path inside the repo) and
  fails fast if any `NEXT_PUBLIC_SUPABASE_*` / `SUPABASE_SERVICE_ROLE_KEY` is set. Fixtures: Invoice Ivy (confirmed Work
  Map `e2e-map-confirmed` linked to a confirmed process at 0.8 understanding, so 'Ready to teach'; open debrief
  `e2e-debrief-open`; ended learner teach session `e2e-teach-learner`) and Ledger Leo (one unconfirmed process, so
  'Training'). `processes.json` holds both processes. `e2e/global-teardown.ts` removes the dir.
- Not part of tests-green (needs a browser). Specs are `*.spec.ts`, so Vitest ignores them. tsc and eslint cover `e2e/`.
- No `test.skip`, `test.fixme`, retries, `waitForTimeout` or soft assertions. Assertions are web-first and wait through
  the `loading.tsx` skeletons.

## Coverage check

`e2e/coverage.ts` `expectCovered(page, expectations)` lists every visible `button`, `a[href]`, `summary`,
`[role=button|menuitem|tab]` and fails on any element whose accessible name has no expectation. Result kinds:
`url` (URL changes), `dialog` (`[role=dialog]` opens), `live` (alert / aria-live text), `download` (download event),
`disabled` (disabled or aria-disabled with the reason visible), `state` (aria-selected/pressed/checked/expanded flips or
the content changes). Each spec then clicks the elements and asserts that result.

## Coverage per screen (docs/design/README.md)

| Board | Spec | What is clicked |
| --- | --- | --- |
| Main, LandingLight, LandingPhone | `landing-login.spec.ts` | section anchors, CTAs to /capture, `?theme=light` vs dark, phone menu |
| Login, LoginSent | `landing-login.spec.ts` | tabs, show/hide, sign in, forgot password, link request (each shows the error without Supabase), sent state and back (`/login/preview`, `?sent=`) |
| Shell, Sidebar | `shell.spec.ts` | every nav link, search (palette opens), collapse and expand, recent sessions (teach, map), user menu, theme Dark and Light, account; workspace switcher is covered as an expectation (Supabase mode only) |
| Gallery, GalleryLight | `agents.spec.ts` | input box start session, agent picker, speak (disabled reason), chips, filter tabs, search, cards, new agent |
| GalleryEmpty, GalleryPhone | `landing-login.spec.ts` | empty state links (`/agents/preview?empty=1`), phone top bar, user menu, card |
| NewAgent 1-3 | `agents.spec.ts` | steps 1 to 3, create, link to capture, cancel |
| Studio | `agents.spec.ts` | pickers, animations, export, save |
| Agent, AgentShortcuts, AgentGuardrails, AgentLearners, AgentSettings | `agents.spec.ts` | tabs, header actions, shortcuts filters, guardrails export and screen-moment replay, learners, rename, delete |
| WorkMap, WorkMapLight | `workmap-debrief.spec.ts` | list, timeline tabs, previous/next, export download, open in Teach, breadcrumb |
| Debrief | `workmap-debrief.spec.ts` | text mode, teach-back confirm and not quite, finish later |
| Learn | `capture-teach.spec.ts` | agent, process, start |
| Capture, OffRecord | `capture-teach.spec.ts` | start, pause/resume, off the record and back, end task -> debrief; share screen disabled with the desktop-app link |
| Teach, TeachSummary | `capture-teach.spec.ts` | start, text input and send, pause/resume, finish -> Mastered / Practice next |
| Workspace | `workspace.spec.ts` | local-mode notice; owner view (`/workspace/preview`): role radio, invite, revoke, remove each show an alert |

### Excluded (not testable in a browser)

| Board | Why |
| --- | --- |
| Buddy, BuddyStop, Dock, DockCollapsed, FloatPanel | desktop app windows (`companion/`), no web route |
| Pairing | obsolete, no pairing |
| Desktop | backdrop only, no route |
| Avatar, Components | component sheets; covered through the screens that use them |
| Workspace switch | Supabase mode only; local mode renders one static row (checked by `src/components/shell/shell.test.tsx`) |

AppOnly controls: the assertion is disabled/aria-disabled plus the reason text and the 'Get the desktop app' link.

## Fixes made

| Fix | Before | After | Check |
| --- | --- | --- | --- |
| Shortcuts tab read the wrong field (T-0172, 6ced609) | tab empty for maps with shortcuts | reads `WorkMap.shortcuts` | `src/app/agents/[id]/agent.page.test.tsx` |
| Login form submit with no Supabase config (T-0173) | `unhandledRejection: supabase_not_configured`, button stuck on busy, no message | every submit handler catches and shows 'That did not work. Try again.' | `landing-login.spec.ts` sign in / forgot / link request |
| LoginSent had no reachable state in local mode (T-0173) | only reachable through a real sign-in link | `/login/preview?sent=<address>` (local mode only, address-shaped values only) | `landing-login.spec.ts` link sent state |
| Stale specs after the shell and processes work (T-0247) | 15 failures: new sidebar controls (search, collapse) uncovered, user menu no longer a `<details>`, theme is a Dark, Light, System radio, home redirects to `/agents`, seed agents never met the ready rule (0.73 understanding, no processes), delete uses a type-to-confirm dialog, learners are labelled from members | shell expectations and specs updated, seed scores 0.8 with `processes.json`, teach session ended (no clock-dependent live row) | the specs themselves |
| Spec fixes (T-0173) | sidebar showed a live `Capture ·` session with no expectation; stacked `page.once` dialog handlers; `getByRole('alert')` matched Next's route announcer | shell expectation covers `Capture`; one handler; announcer excluded | the specs themselves |

## Run result

2026-10-04, `npm run e2e` (Playwright 1.63.0, Google Chrome 154.0.8037.97, macOS): **40 passed**, 0 failed, 0 skipped.

2026-10-04 (T-0247, after the shell and processes work), `npm run e2e`: **39 passed**, 0 failed, 0 skipped. Live specs
ignored by the default config.

Rollback: the e2e infra, specs and src fixes are separate commits. Dropping `e2e/`, `playwright.config.ts`, the `e2e`
script and `@playwright/test` does not touch `src/`.
