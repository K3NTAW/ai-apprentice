# Staging and CI (P0-1, part 2/2)

Two workflows run on every push and pull request, and one nightly workflow runs against staging. Agents spend nothing: creating the staging project, the Vercel env and the GitHub secrets are human steps.

| Workflow | Runs against | Secrets |
| --- | --- | --- |
| `.github/workflows/ci.yml` | nothing external: `npm ci`, `npm run lint`, `npm run typecheck`, `npm test` | none |
| `.github/workflows/db-tests.yml` | the Supabase CLI local stack (`supabase start`) inside the runner | none |
| `.github/workflows/nightly-live.yml` (T-0292) | the staging deployment | `BASE_URL`, `E2E_EMAIL`, `E2E_PASSWORD` |

`db-tests.yml` never touches staging. Decision 2026-10-07 (spec review T-0349): a shared hosted project collects orphan rows and collides between parallel runs, so CI uses only the throwaway local stack. `e2e/workflows.guard.test.ts` fails if `secrets.` appears in `db-tests.yml`.

## 1. Create the staging Supabase project (human)

1. In the Supabase dashboard create a new project, for example `ai-apprentice-staging`, region Zurich or Frankfurt. Free tier is enough.
2. Apply the migrations as in `docs/DEPLOY.md` section 2, against the staging project ref.
3. Auth settings as in `docs/DEPLOY.md` section 3, with the staging Vercel URL as Site URL and redirect URL.
4. Create one test user for the nightly run (Authentication, Users, Add user, confirmed). Its login and password become `E2E_EMAIL` and `E2E_PASSWORD`. Use it for nothing else.

## 2. Staging Vercel env (human)

1. Either a separate Vercel project from the same repo, or the Preview environment of the app project.
2. Set the environment variables listed in `docs/DEPLOY.md` section 5 to the staging project's URL and anon key. Never the production values.
3. Deploy and note the URL. It becomes `BASE_URL`.

## 3. GitHub secrets (human)

Settings, Secrets and variables, Actions, New repository secret. Exactly the names `nightly-live.yml` already reads:

- `BASE_URL`: the staging deployment URL.
- `E2E_EMAIL`: the staging test user's login.
- `E2E_PASSWORD`: the staging test user's password.

`ci.yml` and `db-tests.yml` need no secrets. Do not add Supabase keys to the repository secrets for them.

## 4. Run db-tests locally with Docker

Same as `docs/checks/db-tests.md`, Run locally:

1. Docker running.
2. `supabase start` in the repo root.
3. `supabase status -o env` and take `API_URL`, `ANON_KEY`, `SERVICE_ROLE_KEY`.
4. Keys stay in the shell, never in a file:

```sh
REQUIRE_DB=1 \
SUPABASE_TEST_URL=http://127.0.0.1:54621 \
SUPABASE_TEST_ANON_KEY=... \
SUPABASE_TEST_SERVICE_ROLE_KEY=... \
npm run test:db
```

5. `supabase stop` when done.

In CI, `db-tests.yml` does the same: it reads `supabase status -o env`, masks each value with `::add-mask::` before writing `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY` and `SUPABASE_TEST_SERVICE_ROLE_KEY` to `GITHUB_ENV`, fails if any is empty, runs `npm run test:db` with `REQUIRE_DB=1`, and runs `supabase stop` in an `always()` step. The service key variable is `SUPABASE_TEST_SERVICE_ROLE_KEY`, the name `db-tests/rls.test.ts` reads.

## Pins

- `actions/checkout` v4.2.2 and `actions/setup-node` v4.4.0 by full commit SHA, same as `desktop-release.yml`.
- `supabase/setup-cli` v3.0.1 by full commit SHA, CLI `version: 2.109.0`.
- `nightly-live.yml` still uses tag refs (`@v4`, `@v7`). Pinning it is a follow-up; the guard test has it as a todo.

## First runs

Not observed from the agent worktree: the branch was not pushed. After merge, a human checks the first `CI` and `DB tests` runs under the repository's Actions tab and records the two run URLs here:

- CI: (pending)
- DB tests: (pending)

## Rollback

Delete `.github/workflows/ci.yml`, `.github/workflows/db-tests.yml`, `e2e/workflows.guard.test.ts` and `docs/STAGING.md`.
