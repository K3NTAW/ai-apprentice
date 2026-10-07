# Deferred review findings (T-0293)

Review findings deferred when T-0264 and T-0271 were merged under the deadline rule (roadmap 3.1, P0-3).
Each is closed by a fix and a test in the T-0293 commit (`git log --grep '^T-0293'`).

| Finding | Severity | Fix | Test |
| --- | --- | --- | --- |
| T-0268: `companion/src/window.test.ts` greps `main.mts` text for the partition | low | `mainWindowOptions()` and `installSessionGuardsOn()` in `companion/src/windowActions.mts`; `main.mts` uses both | `window.test.ts` "main window session (T-0255)": options carry `MAIN_PARTITION`, guards land on the default session and `fromPartition(MAIN_PARTITION)` through an injected session factory |
| T-0268: the move to `persist:apprentice` drops old sign-in cookies | low | One-time note in `companion/README.md` (Known changes) and `docs/checks/one-app-desktop.md` (Login flow) | manual check in `one-app-desktop.md` |
| T-0268: `src/lib/auth/context.ts` comment "absent means completed" is stale | low | A forwarded payload without `onboarding` (signed before T-0255, inside the 30 s TTL) is unknown: the context reads the server state with `getUser`; `ctx.onboarding` is always set in Supabase mode; comments in `context.ts` and `AppShell.tsx` updated | `src/lib/auth/context.test.ts` "forwarded payload without onboarding": AppShell `onboardingOpen` and `/onboarding` agree for a finished and an in-progress server state |
| T-0270: `supabaseIdleCapturePort` untested | med | none beyond the cap below | `src/lib/agents/idle.test.ts` against `FakeSupabase`: tables, `t` on `session_events` / `session_transcript` / `session_frames`, `lt` / `is` filters, 42703 and PGRST205 fail the run and end nothing |
| T-0270: `openCaptures` runs three queries per open session with no cap | med | `IDLE_BATCH = 50` per run, oldest first; `endIdleCaptures` returns `{ ended, remaining }`; the cron answer adds `captures_remaining` | `idle.test.ts` cap test (7 sessions, batch 3: 3/4, 3/1, 1/0); `retention.test.ts` |
| T-0270: `fileIdleCapturePort.endSessions` ignored `endedAt`; cron end path differs from `/end` | low | `endSessionAt()` in `src/lib/store/file.ts`, shared by `fileStore.endSession` (POST `/end`) and the file port; the Supabase port documents why it does not use the store's `endSession` (service role across workspaces vs the user's client) | `idle.test.ts` "endSessions writes the given endedAt and never moves an existing ended_at" |
| T-0274: `e2e/live/live.spec.ts` theme restore reads `textContent` | low | Restore picks the checked choice from the fixed list Dark, Light, System | live suite (not run in the unit gate) |
