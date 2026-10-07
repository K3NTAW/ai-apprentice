# RLS tests against a real database (P0-1, part 1/2)

Row level security was verified only by hand. `db-tests/` checks it against a real Postgres with the real migrations, on the Supabase CLI local stack. Never against a hosted or paid project.

Part 2/2 adds the GitHub workflow that runs this suite, the workflow guard test and `docs/STAGING.md`.

## Files

- `supabase/config.toml`: minimal local stack config. `db.major_version = 15`, the version the migrations were written against. `supabase start` applies `supabase/migrations/*` in order. Migrations and rollbacks are untouched.
- `db-tests/vitest.config.ts`: node environment, includes `db-tests/**/*.test.ts` only, does not inherit the root config.
- `db-tests/matrix.ts`: `POLICY_MATRIX` (tables), `STORAGE_MATRIX` (buckets), `RPC_MATRIX` (RPCs that take a workspace or session id).
- `db-tests/tables.test.ts`: no database. Every `create table [if not exists] public.<name>` in `supabase/migrations/*.sql` must have a `POLICY_MATRIX` entry and vice versa. Includes a negative case with a fixture migration string.
- `db-tests/rls.test.ts`: target guard plus the attacks.

`npm run test:db` runs `vitest run -c db-tests/vitest.config.ts`. `npm run lint` covers `db-tests`. `tsconfig.json` already includes `**/*.ts`, so `npm run typecheck` covers `db-tests` without changes. The root `vitest.config.ts` is untouched; its include allowlist keeps `db-tests` out of `npm test`.

## Run locally

1. Docker running.
2. `supabase start` in the repo root (API on port 54621, DB on 54622).
3. `supabase status -o env` and take `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`.
4. Run with the three env vars (keys stay in the shell, never in a file):

```sh
SUPABASE_TEST_URL=http://127.0.0.1:54621 \
SUPABASE_TEST_ANON_KEY=... \
SUPABASE_TEST_SERVICE_ROLE_KEY=... \
npm run test:db
```

5. `supabase stop` when done.

Target guard (`resolveTarget`, unit-tested in `rls.test.ts`):

- `SUPABASE_TEST_URL` unset: prints `SKIPPED: SUPABASE_TEST_URL unset` and passes. With `REQUIRE_DB=1` it fails instead.
- Host must be `localhost` or `127.0.0.1`, or equal `SUPABASE_TEST_ALLOWED_HOST`. Anything else fails before any user is created.

`auto_expose_new_tables = true` in `config.toml`: the migrations grant `authenticated` explicitly and leave `service_role` on the platform default privileges. Newer CLIs no longer auto-grant new tables, so without this the service role cannot seed or tear down. The CLI warns that the field is deprecated from 2026-10-30; when it is removed the migrations need explicit `service_role` grants (separate task).

## The policy matrix

Each table has a category:

- `tenant`: rows belong to one workspace (or one session of it). Members read; other users see and change nothing.
- `global_read`: any signed-in user reads, no client writes (`model_prices`, `voice_prices`).
- `no_client`: no client reads or writes. None today; the suite handles it when one is added.

And a seed route:

- `bootstrap`: `bootstrap_workspace()` under the owner's session.
- `client`: inserted by the owner through PostgREST under their own session (an insert policy exists).
- `service`: inserted with the service role because no client insert policy exists.
- `migration`: rows seeded by the migration itself (price tables).

RPCs that take a workspace or session id, with the denial expected when A calls them with B's id: `is_workspace_member(uuid)` false, `is_workspace_member_text(text)` false, `workspace_role(uuid)` null, `can_read_session(text)` false, `can_write_session(text)` false, `session_frame_prefix(text)` null, `consume_usage(uuid,text,int)` error, `agent_settings_patch(uuid,uuid,jsonb)` null, `create_process(uuid,uuid,text,jsonb,text,boolean)` error. `bootstrap_workspace()` and `create_workspace(text,text)` take no id and are only used for seeding.

Storage: bucket `frames`, paths `workspace_id/session_id/name`.

## What the suite does

1. Creates users A and B through the admin API (unique per-run emails, `email_confirm: true`) and seeds both tenants per the matrix. Every seeded B row id is kept.
2. Precondition under the service role: B's row set is non-empty for every tenant table.
3. As A, per category:
   - tenant: select of B's rows returns zero rows; insert into B's workspace is denied; update and delete against B's real row ids affect zero rows, and B's rows are byte-identical afterwards under the service role; A reads A's own rows.
   - global_read: A selects at least one row; insert, update, delete denied.
   - no_client: zero rows, every write denied.
4. Every RPC in the matrix called as A with B's id returns the listed denial.
5. Anon: select on every table returns zero rows or an error.
6. Frames bucket: upload, download, list, remove each denied for A under B's prefix and allowed under A's own prefix.
7. `afterAll` under the service role, runs even when assertions fail: deletes both workspaces (cascade removes memberships, sessions and children), removes every storage object under both prefixes, deletes both users, then asserts zero rows remain for the run's workspace ids in every tenant table and zero objects under both prefixes.

## Validation

Not run against a local stack in the T-0351 worktree (2026-10-07): Docker was installed but unavailable in practice. `supabase start` pulled the images, then `supabase_db_ai-apprentice` stayed unhealthy during init, could not be stopped ("did not receive an exit event"), and `docker ps` hung afterwards. The 2/2 CI run becomes the validation of the database part. Without a database: `tables.test.ts` and the target guard tests pass, and the suite prints `SKIPPED: SUPABASE_TEST_URL unset`.

## Rollback

Delete `supabase/config.toml`, `db-tests/`, `docs/checks/db-tests.md` and revert the `lint` and `test:db` scripts in `package.json`.
