These checks are run by the human against a real Supabase project before the launch PR is merged. The unit tests mock Supabase and do not replace them.

Use placeholders only (`<project-ref>`, `<origin>`, `<user uuid>`). Never paste real keys or project urls into this file. Env names: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.

# Launch auth checks

Covers `src/proxy.ts`, `src/lib/auth/*`, `/login`, `/auth/callback`, `/auth/signout`, `/workspace` and `src/app/api/workspace/*`.

## Before production

- **Do not run supabase mode in production until the store-routes task lands.** Until then the API routes have no per-route workspace checks; the proxy's 401 for signed-out requests is the only gate in front of them.
- Invites are accepted only at the next login through `/auth/callback` (that is where `bootstrap_workspace` runs for existing members). A user with a live session does not see a new workspace until they sign out and sign in again.

## Dashboard prerequisites

1. Authentication > URL Configuration > **Site URL**: `<origin>`.
2. Authentication > URL Configuration > **Redirect URLs**: add `<origin>/auth/callback**` (wildcard so the `?next=` query is allowed). Add one entry per deployed origin, including preview origins if used. Without a matching entry Supabase silently falls back to the Site URL and the user lands on `/` without a session.
3. Authentication > SMTP: configure **custom SMTP**. The built-in sender is heavily rate limited and meant for testing only. The login form shows a distinct message when Supabase answers 429 / `over_email_send_rate_limit`.
4. The init migration (`supabase/migrations/20261003000000_init.sql`) is applied; see `docs/checks/launch-foundation.md`.

## Two-browser checks

Use two different browsers (or one normal and one private window), browser O for the owner and browser L for the learner.

1. **Owner signs in.** In O open `<origin>/workspace`. Expect a redirect to `/login?next=%2Fworkspace`. Request a link, open it in O. Expect `/workspace` with a personal workspace, your address and role `owner`.
2. **Owner invites.** Invite `<learner email>` as `learner`. The form says no email is sent. Expect the address under Pending invites.
3. **Learner signs in.** In L open `<origin>/login`, request a link for `<learner email>`, open it in L. Expect to land in the owner's workspace (the `ws` cookie points at it), role `learner`. No invite form, no Remove or Revoke buttons, other members shown as 8-char ids.
4. **Owner view.** Reload O. The invite is gone from Pending invites; the learner is listed by address.
5. **Learner who already had a workspace.** Create user C by signing in once (C gets a personal workspace), sign out. Owner invites C. C signs in again: expect to land in the owner's workspace, and the workspace switcher shows both.
6. **Different browser.** Request a link in O for any address and open it in L. Expect `/login` with the "same browser" message (`link_invalid`).
7. **Last owner.** As the only owner, try to remove yourself through the API:
   `fetch('/api/workspace/members', {method:'DELETE', headers:{'content-type':'application/json'}, body: JSON.stringify({userId:'<own user uuid>'})})`. Expect 409 `{"error":"last_owner"}`. The UI does not offer Remove on your own row.
8. **Sign out.** Click Sign out. Expect a redirect to `/`; opening `/workspace` redirects to `/login` again.
9. **Signed-out API.** In a fresh private window: `curl -i <origin>/api/session` answers 401 `{"error":"unauthorized"}`.
10. **Misconfigured production build.** Build with `NODE_ENV=production` and one of the three env vars unset, start it, then: `curl -i <origin>/capture` answers 503 plain text, `curl -i <origin>/api/session` answers 503 `{"error":"supabase_not_configured"}`, `curl -i <origin>/` answers 200.

## Notes

- The proxy fails closed: when Supabase Auth is unreachable, `getUser` errors are treated as signed out (redirect to `/login`, or 401 on `/api/*`). It does not answer 503 for an Auth outage.
- API routes get their own per-route checks in the next (store-routes) task. Until then the proxy's 401 is the first line.
- Member emails are shown to owners only. Other roles see their own address and short ids for everyone else.

## Rollback

Revert this task's commit. No schema change is part of this task. Deleting `src/proxy.ts` alone removes the global gate (all pages and `/api/*` become reachable without a session), so only do that together with the revert.
