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
| router prefetch (viewport or hover, RSC prefetch) | 2 | 1 (the render only, proxy skips) |
| /api/* route handler | 2 (proxy, then requireContext) | 1 (requireContext; it still answers 401) |
| static asset outside the matcher exclusions | 1 | 0 |

The forwarded user is an HMAC-signed request header (`x-aa-verified-user`, 30 s expiry). The proxy deletes any
client-sent header of that name on every request; getRequestContext ignores a value that does not verify and calls
getUser itself; requireContext never reads it. Key: `FORWARDED_USER_SECRET`, else derived from
`SUPABASE_SERVICE_ROLE_KEY`, else a random per-process key (then the render falls back to getUser).

## Read-mostly caches

- Per request: getRequestContext stays under React cache().
- Across requests, 5 s, supabase mode only, unstable_cache keyed `[name, user:<id>, ws:<id>]`:
  memberships (tag `user:<id>:memberships`), the agents input behind the agent list and stats
  (`ws:<id>:agents`, `ws:<id>:sessions`, `ws:<id>:members`), the sidebar recent sessions (`ws:<id>:sessions`).
- Expired by: agent POST/PATCH/DELETE (agents); session, events, transcript, qa, off-record, end, vision, workmap,
  workmap/confirm writes (sessions); bootstrap (memberships, members); member removal (the removed user's memberships,
  members). Route handlers (requireContext) never read the memberships cache. Errors and empty results are not cached.

## Prefetch and refresh

- Primary nav keeps viewport prefetch. Sidebar recent sessions, agent cards, control room workflow rows and the
  /map list use HoverPrefetchLink: `prefetch={false}`, router.prefetch on hover or focus.
- router.refresh: one per mutation already (WorkspaceClient.run, AgentSettings save); unchanged.

## Timing

- Pages: the proxy sends `Server-Timing: proxy-auth;dur=<ms>`. ctx-auth and db (memberships) inside the render are
  logged with `PERF_LOG=1` (`[perf] ctx-auth 182.3ms`), since a server component cannot set response headers.
  Render is the remainder: TTFB minus proxy-auth minus the logged steps.
- Route handlers keep `Server-Timing: auth;dur, db;dur` (withApi).

## TTFB (median of 5, scripts/measure-ttfb.mjs)

Local mode (`npm run dev`, no Supabase) only checks that the script and pages run: it has no Auth or database round
trips, so it says nothing about the preview. The preview numbers are for the human to fill in, before (goal branch
without T-0174) and after (this branch):

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
