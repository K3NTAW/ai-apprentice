# Workspace switch: root cause check (T-0353, split 1/2 of T-0299)

Roadmap P0-2. Fix round for T-0283. 2/2 (WorkspaceSwitcher component test) is separate.

Result: **held: not reproduced.** The new tests found no src defect, so src is unchanged and there is no fix commit.

## Tests added or changed

- `src/lib/auth/workspaceSwitch.test.ts`
  - Removed both `?? jar.header` fallbacks. `state.requestCookie` now comes only from the proxy's
    `x-middleware-request-cookie`, and `forwardedCookie()` fails when that header is missing.
  - Refresh-path case through the real `src/proxy.ts`. Only `createServerClient().auth.getUser` is mocked. `setAll`
    gets cookies shaped like @supabase/ssr 0.12.7 (version from package-lock.json): `sb-<ref>-auth-token.0` and
    `.1` with new values, plus `.2` with an empty value and `maxAge: 0`. The forwarded header is split on `"; "`,
    then on the first `"="`, and the values are URI-decoded. Asserted: `ws=WS_B`; `.0` and `.1` carry the new
    values; `.2` is absent or empty; Set-Cookie carries `.0` and `.1` and has no `ws` other than WS_B; the render
    resolves WS_B.
  - No-refresh case: `setAll` is never called, the forwarded header equals the request Cookie header, and there is
    no Set-Cookie.
  - Parse-step case: a header with a percent-encoded ws (`%2D` for every `-`) plus chunked sb cookies goes through
    Next's own `RequestCookies` (`next/dist/server/web/spec-extension/cookies`, the class `next/headers` `cookies()`
    wraps) and resolves to `workspaceId` WS_B. The `next/headers` mock now builds `cookies()` from that same class,
    not a hand-written parse.
- `src/components/shell/menuActions.test.ts`: a call log shows the order is fetch, then fetch settled, then
  reload. A 400, 401, 403 or 500 response, or a thrown fetch, never reloads and returns `ok:false`.
- `src/app/api/workspace/active/cookie.test.ts`: covers `development` and `production` with
  `vi.stubEnv("NODE_ENV")` and `vi.resetModules()`. `wsCookieOptions` reads `NODE_ENV` on every call, not at
  import. Checked: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age>0`, `Secure` only in production, and the ws value
  equals the requested id. The 403 (not a membership) and 400 (bad uuid, bad JSON) responses set no cookie.

## 1. Pre-fix run against unmodified src (verbatim)

`npx vitest run src/lib/auth/workspaceSwitch.test.ts src/components/shell/menuActions.test.ts src/app/api/workspace/active/cookie.test.ts`

```
 ❯ src/lib/auth/workspaceSwitch.test.ts (8 tests | 1 failed) 243ms
   ❯ switching the active workspace (7)
     × a signed-out redirect to /login leaves ws alone 137ms

 FAIL  src/lib/auth/workspaceSwitch.test.ts > switching the active workspace > a signed-out redirect to /login leaves ws alone
AssertionError: proxy response has no x-middleware-request-cookie: expected null not to be null
 ❯ forwardedCookie src/lib/auth/workspaceSwitch.test.ts:111:75
 ❯ loadPage src/lib/auth/workspaceSwitch.test.ts:141:25
 ❯ src/lib/auth/workspaceSwitch.test.ts:205:17

 Test Files  1 failed | 2 passed (3)
      Tests  1 failed | 22 passed (23)
```

Why this is not a switch bug: a signed-out page request gets `NextResponse.redirect` to /login. A redirect never
renders, so it has no forwarded request headers. The removed `?? jar.header` fallback was hiding that in the
harness. The fix is in the test only: `loadPage(jar, path, { render: false })` for the redirect case, which now
asserts that `x-middleware-request-cookie` is null. Every switch assertion passed on unmodified src: the
refresh-path chunks, the deletion chunk, ws on Set-Cookie, the parse step, the reload order and the cookie
attributes.

## 2. Fix

None. No src file changed (`src/proxy.ts`, `src/lib/auth/context.ts` and `src/components/shell/menuActions.ts` are
untouched), so there is nothing to revert. To revert the test and doc changes, run
`git revert <T-0353 commit>`, or restore these four files: `src/lib/auth/workspaceSwitch.test.ts`,
`src/components/shell/menuActions.test.ts`, `src/app/api/workspace/active/cookie.test.ts` and
`docs/checks/workspace-switch.md`.

## Ruled-out hypotheses

| Hypothesis | Command | Output | Verdict |
|---|---|---|---|
| Proxy drops or rewrites ws when it refreshes the session (chunked cookies, deletion chunk) | the vitest run above, refresh-path case | passed | ruled out: ws=WS_B forwarded, never on Set-Cookie with another value |
| Render parse mangles a percent-encoded ws or chunked sb cookies | the vitest run above, parse-step case | passed | ruled out |
| workspaceMeta/context cache keys in `src/lib/auth/context.ts` pin the old workspace | `grep -n "readMostly(\|workspaceId: wsCookie\|pickActive(memberships, wsCookie)" src/lib/auth/context.ts` | `163: const ids = { userId, workspaceId: wsCookie ?? "none" };` `164: readMostly("memberships", ...)` `171: readMostly(` `239: const active = pickActive(memberships, wsCookie);` | ruled out: the cache holds only the membership list (keyed by user and ws cookie); the active workspace is picked outside the cache from the live cookie on every request |
| `switchWorkspace` reloads before the POST resolves or on failure | `npx vitest run src/components/shell/menuActions.test.ts` | passed | ruled out: fetch, then settled, then reload; no reload on !ok or throw |
| `useMenu.ts` interferes (navigation, cookies) | `grep -nE "fetch\|reload\|cookie\|location" src/components/shell/useMenu.ts` | no match (exit 1) | ruled out: positioning and focus only |
| Live helper `switchTo` in `e2e/live/live.spec.ts` races the reload (read-only inspection) | `sed -n 60,76p e2e/live/live.spec.ts` | registers `waitForResponse` (POST /api/workspace/active) and `waitForEvent("load")` before the click, asserts the POST is ok, awaits the load, then checks the switcher, reloads and checks again | ruled out as a harness race: both waits are armed before the click |
| ws cookie attributes differ by environment (Secure in dev, missing Path or Max-Age) | `npx vitest run src/app/api/workspace/active/cookie.test.ts` | passed | ruled out |

Reload wiring for reference (2/2 covers the component): `grep -nE "reload|switchWorkspace" src/components/shell/WorkspaceSwitcher.tsx`
gives `49: reload: () => window.location.reload(),` and `141: const result = await switchWorkspace(workspaceId, activeId, browserDeps());`.

## Manual follow-up

Live steps 07 (workspace switch) and 13 in `e2e/live/live.spec.ts` against the deployed app stay manual. Unit level
does not reproduce the failure, so the next evidence has to come from those runs: a trace with the POST response
Set-Cookie and the Cookie header of the reload request.
