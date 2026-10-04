# Performance: query counts and TTFB

Baseline recorded 2026-10-04 against the code before T-0170 (commit "baseline query counts", same test).
Numbers are Supabase queries per loader, from the fake client call log in `src/lib/store/queryCounts.test.ts`,
for N = 1, 5 and 50 sessions in the workspace. The test asserts these exact rows, so the doc cannot drift.

| loader | before (N = 1 / 5 / 50) | after (N = 1 / 5 / 50) |
| --- | --- | --- |
| listSessions | 4 / 16 / 151 | 1 / 1 / 1 |
| dashboard | 11 / 43 / 403 | 2 / 2 / 2 |
| agents | 12 / 44 / 404 | 3 / 3 / 3 |

Before: listSessions ran 1 + 3N (one count per child table per session); the control room loaded every full session
(5 queries each) plus members and teach creators. After: listSessions uses PostgREST embedded counts
(`*,session_events(count),session_transcript(count),session_qa(count)`), and the loaders read `listSessionDigests()`
(one sessions query without child rows, created_by included) in parallel with the members query.

## Per page

| page | before | after |
| --- | --- | --- |
| /agents, /agents/[id], /learn (loadAgentsInput) | 4 + 8N queries | 3 queries |
| /map/[id] learners (loadDashboardInput) | 3 + 8N queries | 2 queries |
| /map list (client) | 1 + K requests (K = sessions with a map), 1 + 3N + 5K queries | 1 request (`/api/workmaps`), 1 query |
| /teach loadWorkMap | up to 2 + K sequential requests | 1 request (`?session_id` included) |
| /teach picker | 1 + K requests | 1 request |
| /api/export?agent_id | 1 + 3N + 5K queries | 2 queries |

Plus the auth context per request (getUser, memberships), counted once per request (see below).

## Measuring TTFB

- `curl -s -o /dev/null -w 'ttfb %{time_starttransfer}s total %{time_total}s\n' -b 'sb-...=<cookie>' https://<host>/api/session`
- Browser devtools, Network, the document request: Timing, "Waiting for server response".
- Route handlers under withApi send `Server-Timing: auth;dur=<ms>, db;dur=<ms>`; devtools shows it in the Timing tab.
  auth is requireContext (getUser plus memberships), db is the handler body (store queries dominate it).
  Render timing is out of scope.

# Performance 2 (web): auth round trips, prefetches, read-mostly caches (T-0174, 2026-10-04)

Report: "still slow and stalls on different clicks". Functions run in fra1 (Fluid compute), the database in eu-central-2.

## Auth round trips per request (counted from the code, covered by src/proxy.test.ts and src/lib/auth/context.test.ts)

| request | before | after |
| --- | --- | --- |
| page navigation (document or RSC) | 2 getUser (proxy, then getRequestContext) | 1 (proxy; the render reuses the signed forwarded user) |
| router prefetch (viewport or hover, RSC prefetch) | 2 | 1 (proxy; redirected when signed out, the render reuses the forwarded user) |
| /api/* route handler | 2 (proxy, then requireContext) | 1 (requireContext; it still answers 401) |
| /_next/* outside the matcher exclusions | 1 | 0 |
| any other path ending in .js, .css, .txt and similar | 1 | 1 (still a protected page, T-0178) |

T-0178 (fix round, code review T-0177): T-0174 skipped the proxy session check for router prefetches and for any
path ending in a static extension. Both are client controlled, so a signed-out request with `next-router-prefetch: 1`
reached the render without the sign-in redirect. Now only /api/* and /_next/* skip the proxy getUser.

### getUser calls per page request (from the test call logs, before = f103f05, after = this branch)

Counted by `src/lib/auth/context.test.ts` ("one getUser per page request (proxy plus context)": the proxy's
getUser counter plus the render client's getUser mock calls for one request) and `src/proxy.test.ts` ("getUser calls
in the proxy per request"). Every main page goes through the same proxy and getRequestContext, so the count is the
same per page.

| page | before | after | after, no FORWARDED_USER_SECRET and no service role key |
| --- | --- | --- | --- |
| /agents | 2 | 1 | 2 |
| /dashboard | 2 | 1 | 2 |
| /map | 2 | 1 | 2 |
| /learn | 2 | 1 | 2 |
| /capture | 2 | 1 | 2 |
| /workspace | 2 | 1 | 2 |
| /agents prefetch (next-router-prefetch) | 2 | 1 | 2 |
| /api/session | 2 | 1 | 1 |

The forwarded user is an HMAC-signed request header (`x-aa-verified-user`, 30 s expiry). The proxy deletes any
client-sent header of that name on every request; getRequestContext ignores a value that does not verify and calls
getUser itself; requireContext never reads it. Key: `FORWARDED_USER_SECRET`, else derived from
`SUPABASE_SERVICE_ROLE_KEY`, else a random per-process key (then the render falls back to getUser).

## Read-mostly caches

- Per request: getRequestContext stays under React cache().
- Across requests, 5 s, supabase mode only, unstable_cache keyed `[name, user:<id>, ws:<id>]`:
  memberships (tag `user:<id>:memberships`), the agents input behind the agent list and stats
  (`ws:<id>:agents`, `ws:<id>:sessions`, `ws:<id>:members`), the sidebar recent sessions (`ws:<id>:sessions`).
- Expired by: agent POST/PATCH/DELETE (agents); session create, end and workmap/confirm (sessions; there is no
  session delete route); bootstrapAfterSignIn, so both /auth/callback and /api/auth/bootstrap (memberships, members
  of a joined workspace); member removal (the removed user's memberships, members). Route handlers (requireContext)
  never read the memberships cache. Errors and empty results are not cached.
- Not expired by capture writes (events, transcript, qa, vision frames, off-record, workmap): they arrive several
  times a second during a capture. The sidebar and agent stats can lag a live capture by the cache TTL (5 s).

## Prefetch and refresh

- Primary nav keeps viewport prefetch. Sidebar recent sessions, agent cards, control room workflow rows and the
  /map list use HoverPrefetchLink: `prefetch={false}`, router.prefetch on hover or focus.
- router.refresh: one per mutation already (WorkspaceClient.run, AgentSettings save); unchanged.

## Timing

- Pages (supabase mode): the proxy sends `Server-Timing: ctx-auth;dur=<ms>, db;dur=0.0, total;dur=<ms>`. ctx-auth is
  the proxy getUser (the only one per page), db is store time in the proxy (none), total is proxy start to response.
  The render's own steps (memberships read, loaders) are logged with `PERF_LOG=1` (`[perf] db 41.0ms`), since a
  server component cannot set response headers. Render is the remainder: TTFB minus total minus the logged steps.
  Local mode has no proxy work and sends no page Server-Timing.
- Route handlers (withApi): `Server-Timing: ctx-auth;dur, db;dur, total;dur`. ctx-auth is requireContext (getUser plus
  memberships), db is the sum of the store calls of the request (overlapping calls each count), total is requireContext
  start to response. A 401 from requireContext carries the same three entries (db 0).

## TTFB (median of 5, scripts/measure-ttfb.mjs)

### Local mode, measured 2026-10-04

`next dev` (local mode exists only outside production, no Supabase), both servers warm (every page requested twice
first), 10 runs per page, two rounds, same machine. Before = f103f05 (goal/T-0001 right before the T-0174 lineage;
the merge-base ec2d4f4 has no app yet), after = this branch. Median TTFB in ms, round 1 / round 2:

| page | before ms | after ms |
| --- | --- | --- |
| /agents | 39 / 40 | 45 / 41 |
| /dashboard (307 to the default page) | 20 / 21 | 30 / 22 |
| /map | 34 / 32 | 40 / 35 |
| /learn | 39 / 38 | 44 / 39 |
| /capture | 36 / 37 | 65 / 40 |
| /workspace | 63 / 35 | 41 / 38 |
| /api/session | 6 / 5 | 5 / 5 |

Reading: no difference beyond noise (round 1 has dev-server outliers, e.g. /capture max 205 ms). Local mode has no
Auth or database round trips and the proxy returns at once, so it cannot show what T-0174 and T-0178 change; it
checks that the script and pages run. The changes are in the getUser counts above, and the preview run below is the
real measure. /api/session after: `ctx-auth;dur=0.0, db;dur=0.1, total;dur=0.3`.

### Preview (supabase mode), for the human to fill in

| page | before ms | after ms |
| --- | --- | --- |
| /agents | | |
| /dashboard | | |
| /map | | |
| /learn | | |
| /capture | | |
| /workspace | | |
| /api/session | | |

How to run against the preview:

1. Sign in on the preview in a browser. Devtools, Application, Cookies: copy the `sb-<ref>-auth-token` cookie(s)
   (there may be `.0` and `.1` chunks) and `ws`.
2. In a shell (the cookie stays in the environment, never in a file):
   `BASE_URL=https://<preview-host> SESSION_COOKIE='sb-<ref>-auth-token.0=...; sb-<ref>-auth-token.1=...; ws=...' node scripts/measure-ttfb.mjs`
3. Run it once on a preview of the goal branch (before) and once on this branch (after); paste the medians above.
   `RUNS=10` or `PAGES=/agents,/map` narrow or widen the run. A 307 status means the cookie expired.

## Desktop app (companion) CPU

T-0175, 2026-10-04. Complaint: the app "stalls on different clicks".

### Measuring

- `COMPANION_PERF=1 npm --prefix companion run dev` logs `app.getAppMetrics()` every 5 s:
  `[companion] cpu <total>% | Browser:<pid> <cpu> | GPU:<pid> <cpu> | Tab:<pid> <cpu> ...`
- Let each state settle for 30 s, then average the last 4 lines. Activity Monitor (CPU, Energy, GPU) as a cross-check.
- States: idle (app open, no session, cursor still), capture (session in capture, dock visible),
  teach (session in teach, buddy visible, cursor moving then resting).

### Results (total CPU %, all companion processes)

T-0180, 2026-10-04, this Mac (Apple silicon, macOS 26), Electron 44.5.1, web app on `npx next dev` (local mode),
`APP_URL=http://localhost:<port>`. Before = `goal/T-0001` companion (before T-0175), after = T-0180 head.
Average of 12 samples (5 s apart, 60 s) after 10 s settling; the app was quit after every run.

| state | before | after |
| --- | --- | --- |
| idle | 2.2 | 0.7 |
| capture (dock visible) | 3.5 | 3.1 |
| teach (buddy visible) | 2.3 | 2.2 |

Per process (average CPU %):

| state | version | Browser | GPU | main window | overlay | dock |
| --- | --- | --- | --- | --- | --- | --- |
| idle | before | 0.1 | 1.2 | 0.5 | 0.4 | hidden |
| idle | after | 0.1 | 0.4 | 0.0 | 0.2 | hidden |
| capture | before | 0.2 | 2.2 | 0.6 | 0.3 | 0.2 |
| capture | after | 0.0 | 2.2 | 0.6 | 0.0 (hidden) | 0.2 |
| teach | before | 0.1 | 1.3 | 0.5 | 0.4 | hidden |
| teach | after (2 runs) | 0.1 | 1.3 | 0.55 | 0.25 | hidden |

The network utility process was 0.0 everywhere. Teach after is the mean of two runs (2.4, 2.0). A first
teach-before run (1.8) was dropped: no window was visible in its samples, so the buddy was not on screen.

How it was run:
- A harness outside the repo (`/tmp`, not shipped) set its own `appData` (another dev companion on this machine held
  the single-instance lock in the default one), logged `app.getAppMetrics()` every 5 s labelled per window
  (main, overlay, dock), and then loaded the companion's built `dist/main.mjs` unchanged. Before has no
  `COMPANION_PERF`, so both sides used the harness for the same method.
- States were set through the page's own bridge: `window.apprentice.send(session.state)` over the Chrome DevTools
  Protocol, mode `capture` or `teach`, re-sent every 5 s. Idle: page connected, no session.

Limits:
- No macOS permission prompts appeared and none were granted. The input hook (uiohook) was not rebuilt for
  Electron, so it did not run: after, the cursor poll never pauses (it needs the hook to resume) and stays at 30 Hz
  in teach; with the hook it pauses after 2 s of rest. The cursor was resting in all runs.
- Capture is the companion side only: the injected session.state does not make the page capture screen frames
  or start voice, so frame and voice cost in the page are not in these numbers.
- Most of the remaining cost in capture and teach is the GPU process (compositing the visible dock, main window
  and overlay); idle drops most because the main window is throttled and the overlay loop sleeps.

### What changed

- Overlay (`static/overlay.js`, `static/scheduler.js`): the requestAnimationFrame loop ran every frame forever, in a
  full-screen transparent always-on-top window per display. It now runs only while the buddy flies or eases toward
  its goal and stops when settled; a new view (buddy.point, halo, say, state) or cursor update wakes it. Halos and
  buddy modes pulse in CSS, which needs no loop.
- Overlay windows are hidden (not just empty) when they draw nothing and in capture mode (the buddy is hidden there).
- Cursor poll: was 16 ms (about 60 Hz) whenever the buddy was enabled. Now 34 ms (at most 30 Hz), only while the
  buddy is shown, paused after 2 s without movement, resumed by the uiohook mousemove event (never paused without
  the hook). Only moved points are sent.
- Frontmost app poll: was 500 ms always; now 500 ms during a session, 5 s otherwise.
- Permission poll: was 2 s always; now 10 s and only while a permission is missing.
- buddy-view, cursor, dock-state and panel-state IPC are sent only when the value changed.
- Main window: backgroundThrottling is off during a session (voice and frames) and during voice without a
  capture/teach mode (buddy.state listening/thinking/speaking or session.state `voice_active`, e.g. the debrief
  interview); it returns 30 s after the last activity (T-0180).
- Permissions are re-checked when the app becomes active or a window gets focus, and when a session starts, so a
  permission revoked while the app runs is noticed without relaunch (T-0180).
- All repeating timers are cleared on quit.
