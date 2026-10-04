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
