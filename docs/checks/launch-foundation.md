These checks are run by the human against a real Supabase project before the launch PR is merged; the automated test is only a lint.

The rollback, delete-owner and workspace-delete checks are destructive and run only against a scratch project. They are marked **[scratch only]** below. Use placeholders only (`<project-ref>`, `<anon key>`, `<user uuid>`, `<access token>`). Never paste real keys or project urls into this file.

# Launch foundation checks

Covers `supabase/migrations/20261003000000_init.sql` and `supabase/rollbacks/20261003000000_init.down.sql`.

## Setup

- **The SQL editor bypasses RLS.** It runs as `postgres`. Run every per-user check inside a transaction that switches role and sets the JWT claims:

  ```sql
  begin;
  set local role authenticated;
  select set_config('request.jwt.claims', '{"sub":"<user uuid>","role":"authenticated"}', true);
  -- check statements here
  rollback; -- or commit when the check must persist
  ```

  For anon checks in SQL use `set local role anon;` and leave out the `sub` claim.
- **Users.** Create user A and user B through Auth (Dashboard > Authentication > Add user) with a confirmed email (tick auto confirm). `bootstrap_workspace` raises for an unconfirmed email. Copy each user uuid from the dashboard.
- **Storage checks** go through the Storage API with a user access token, not through SQL:

  ```sh
  # get a user access token
  curl -s -X POST 'https://<project-ref>.supabase.co/auth/v1/token?grant_type=password' \
    -H 'apikey: <anon key>' -H 'Content-Type: application/json' \
    -d '{"email":"<user a email>","password":"<user a password>"}'

  # upload a frame
  curl -s -X POST 'https://<project-ref>.supabase.co/storage/v1/object/frames/<workspace uuid>/<session id>/f1.jpg' \
    -H 'apikey: <anon key>' -H 'Authorization: Bearer <access token>' \
    -H 'Content-Type: image/jpeg' --data-binary @f1.jpg

  # upsert the same frame
  curl -s -X POST 'https://<project-ref>.supabase.co/storage/v1/object/frames/<workspace uuid>/<session id>/f1.jpg' \
    -H 'apikey: <anon key>' -H 'Authorization: Bearer <access token>' \
    -H 'x-upsert: true' -H 'Content-Type: image/jpeg' --data-binary @f1.jpg
  ```

- **Anon checks** go through the REST rpc endpoint with the anon key only:

  ```sh
  curl -s -X POST 'https://<project-ref>.supabase.co/rest/v1/rpc/bootstrap_workspace' \
    -H 'apikey: <anon key>' -H 'Authorization: Bearer <anon key>' \
    -H 'Content-Type: application/json' -d '{}'
  ```

## Apply

- SQL editor: paste `supabase/migrations/20261003000000_init.sql` and run it, or
- CLI: `supabase link --project-ref <project-ref>` then `supabase db push`. `supabase/config.toml` is not part of this task.

## Roll back [scratch only]

1. Run `supabase/rollbacks/20261003000000_init.down.sql` in the SQL editor. It is not a data backup.
2. If the migration was applied with `supabase db push`: `supabase migration repair --status reverted 20261003000000`.
3. Bucket cleanup: empty and delete the `frames` bucket through the dashboard or the Storage API. The rollback never touches it.

## Checks

Two users, A and B, each in their own workspace (WA, WB) after their first bootstrap. Expected result after each arrow.

### Bootstrap

1. As A: `select * from public.bootstrap_workspace();` -> one row, role `owner`, name = local part of A email. Call again -> same single row, `select count(*) from public.workspaces` as postgres grows by 0.
2. Parallel bootstrap: with a fresh confirmed user C, open two SQL editor tabs, run in both `begin; set local role authenticated; select set_config('request.jwt.claims', '{"sub":"<user c uuid>","role":"authenticated"}', true); select * from public.bootstrap_workspace();` then commit both -> as postgres `select count(*) from public.workspaces where created_by = '<user c uuid>'` returns 1.
3. Mixed-case invite: as A insert `insert into public.workspace_invites (workspace_id, email, role, invited_by) values ('<wa uuid>', 'd@example.com', 'learner', '<user a uuid>');`, then create user D in Auth as `D@Example.com` (confirmed) and bootstrap as D -> D gets one row for WA with role `learner` and no own workspace. The invite row has `accepted_at` set.
4. Invited after first login: as A invite B's email to WA, then bootstrap as B again -> B now returns rows for WB (`owner`) and WA (`learner`).
5. Unconfirmed email: create user E in Auth without confirming, invite E to WA, bootstrap as E -> raises `email not confirmed`. As postgres, E has no workspace_members row and the invite still has `accepted_at` null.

### Isolation between workspaces

6. As B, against WA rows: `select` on `workspaces`, `workspace_members`, `workspace_invites`, `sessions`, `session_events`, `session_transcript`, `session_qa`, `session_frames` -> 0 rows each. `insert` of a session or child row into WA or a WA session -> RLS violation. `update` and `delete` on WA rows -> 0 rows affected.
7. As B: `select public.session_frame_prefix('<session in wa>');` -> null. Same for a missing id -> null. `select public.can_read_session('<session in wa>'), public.can_write_session('<session in wa>');` -> false, false (same as for a missing id).
8. As B, with the Storage API: list or download an object under `<wa uuid>/` -> not found / empty.

### Sessions and child rows

9. As A: `update public.sessions set workspace_id = '<wb uuid>' where id = '<session in wa>';` -> raises `sessions.workspace_id cannot change`.
10. As A: `update public.session_events set session_id = '<other session in wa>' where id = <event id>;` -> raises `session_events.session_id cannot change`. Repeat for `session_transcript`, `session_qa`, `session_frames`.
11. Non-creator member: as owner A create session S1 in WA. Add learner D (step 3) and expert F the same way. As F insert a capture session S2 (`created_by` = F). As D: `update public.sessions set expert = 'x' where id = 'S2';` -> 0 rows. As A (owner): same update on S2 -> 1 row.
12. Learner kinds: as D insert `kind = 'teach'` into WA -> ok. As D insert `kind = 'capture'` -> RLS violation.
13. Id format: as A insert a session with id `bad id!` -> check violation. Insert with an id of 129 characters (`repeat('a', 129)`) -> check violation. 128 characters -> ok.
14. Removed member: as A `delete from public.workspace_members where workspace_id = '<wa uuid>' and user_id = '<user f uuid>';` -> 1 row. As F: update or insert child rows on S2 -> 0 rows / RLS violation.
15. Foreign storage_path: as A `insert into public.session_frames (session_id, name, t, storage_path) values ('<session in wa>', 'f1.jpg', 0, '<wb uuid>/<session in wa>/f1.jpg');` -> RLS violation. With `storage_path` = `'<wa uuid>/<session in wa>/f1.jpg'` -> ok.

### Members and invites

16. Direct member insert: as A `insert into public.workspace_members (workspace_id, user_id, role) values ('<wa uuid>', '<user b uuid>', 'expert');` -> RLS violation (no insert policy).
17. Last owner: as A `update public.workspace_members set role = 'expert' where workspace_id = '<wa uuid>' and user_id = '<user a uuid>';` -> raises `would have no owner`. `delete` of A own membership -> same error.
18. Invite policies: as D (learner in WA) `insert into public.workspace_invites (workspace_id, email, role, invited_by) values ('<wa uuid>', 'x@example.com', 'expert', '<user d uuid>');` -> RLS violation. As D `select * from public.workspace_invites` -> 0 rows. As D or as A `update public.workspace_invites set role = 'expert'` -> 0 rows (no update policy, accepted invites included).
19. As A insert an invite with `invited_by` = B uuid -> RLS violation.

### Ownership transfer (for the sole-owner account-deletion case)

Test this snippet in a scratch project before using it on real data.

```sql
begin;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"<old owner uuid>","role":"authenticated"}', true);
-- 1. promote the new owner (must already be a member)
update public.workspace_members set role = 'owner'
where workspace_id = '<workspace uuid>' and user_id = '<new owner uuid>';
-- 2. then demote or remove the old owner
update public.workspace_members set role = 'expert'
where workspace_id = '<workspace uuid>' and user_id = '<old owner uuid>';
-- or: delete from public.workspace_members where workspace_id = '<workspace uuid>' and user_id = '<old owner uuid>';
commit;
```

Expected: both statements succeed. Running step 2 without step 1 raises the last-owner error.

### Destructive [scratch only]

20. Delete a sole owner: delete user A in Auth (dashboard) -> refused with the last-owner guard error (`would have no owner`). A is still listed.
21. Delete a user who is not a sole owner: delete user F in Auth -> ok. As postgres, S2 still exists with `created_by` null, F has no workspace_members rows.
22. Workspace delete: as A `delete from public.workspaces where id = '<wa uuid>';` -> 1 row. As postgres, no `workspace_members`, `workspace_invites`, `sessions` or child rows remain for WA. Frames objects under `<wa uuid>/` remain until the app or the dashboard removes them.
23. Rollback twice on a populated database: with data in every table and at least one object in `frames`, run the down file -> ok, the verification block at its end returns 0 rows. Run it again -> ok, only notices, 0 rows. In the dashboard the `frames` bucket and its objects are untouched. Run the repair command. Re-apply the migration -> ok (the bucket insert hits `on conflict do nothing`).

### Storage

24. As A with A's token: upload `<wa uuid>/<session in wa>/f1.jpg` -> 200. Upsert the same path with `x-upsert: true` -> 200. Upload to `<wb uuid>/<session in wb>/f1.jpg` -> 403 (RLS). Upload to `<wb uuid>/<session in wa>/f1.jpg` -> 403 (prefix mismatch).
25. As D (learner, not creator of the session): upload under A's session -> 403. Download from `<wa uuid>/...` -> 200 (members can read).

### Anon

26. With the anon key: rpc calls to `session_frame_prefix`, `can_read_session`, `can_write_session` and `bootstrap_workspace` -> permission denied (401/403, `42501`). `GET /rest/v1/workspaces` and the same for the other seven tables -> permission denied. In SQL: `begin; set local role anon; select * from public.sessions;` -> `permission denied for table sessions`.
